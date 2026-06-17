console.log("Script loaded")

//Airbag Mechanism code
const INSTRUMENT_TYPE = {
    HSI: "index",
    STI: "index",
    NDX: "index",
    DBS: "stock",
    SGT: "stock",
    DEMO: "stock",
};

const AIRBAG_TRIGGERS = {
    index: {
        2: { long: -0.20, short: 0.20},
        3: { long: -0.20, short: 0.20},
        5: { long: -0.10, short: 0.10},
        7: { long: -0.10, short: 0.10},
    },
    stock: {
        3: { long: -0.20, short: 0.20},
        5: { long: -0.15, short: 0.15},
    }
};
 
//Data parsing
function groupByDay(candles) {
    const days = {};
    candles.forEach(candle => {
        const day = candle.datetime.slice(0, 10);
        if (!days[day]) {
            days[day] = [];
        }
        days[day].push(candle);
    });
    return days;
}

function formatLocalDateTime(date) {
    const pad = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

//Chart creation
function initChart() {
    const ctx = document.getElementById("myChart").getContext("2d");
    const chart = new Chart(ctx, {
        type: "line",
        data: {
            datasets: [
                {
                    label: "Underlying",
                    data: [],
                    borderColor: "#ffffff",
                    borderWidth: 1,
                    pointRadius: 0,
                    spanGaps: false
                },
                {
                    label: "DLC Value",
                    data: [],
                    borderColor: "#E60028",
                    borderWidth: 2,
                    pointRadius: 0,
                    spanGaps: false
                },
                {
                    label: "DLC Without Airbag",
                    data: [],
                    borderColor: "#ff8800",
                    borderWidth: 1,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    spanGaps: false
                }
            ]  
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: { 
                    type: "category",
                    ticks: {
                        maxTicksLimit: 12,
                        color: "#aaaaaa",
                        maxRotation: 45,
                        minRotation: 0,
                        autoSkip: true,
                        callback: function(value, index) {
                            const label = this.getLabelForValue(value);
                            if (!label) return null;
                            const date = label.slice(0, 10);
                            const time = label.slice(11, 16);
                            const minute = parseInt(label.slice(14, 16));
                            const expiryDays = this.chart.options.scales.x.expiry || 1;

                            if (expiryDays <= 3) {
                                const prevLabel = index > 0 ?
                                    this.getLabelForValue(index - 1) : null;
                                const prevDate = prevLabel ? prevLabel.slice(0, 10) : null;
                                if (date !== prevDate) return date;
                                if (minute === 0) return time;
                                return null;
                            } else {
                                if (minute === 0 && parseInt(label.slice(11, 13)) === 12) return date;
                                return null;
                            }
                        }
                    },
                    grid: { color: "#333333"}
                },
                y: {
                    type: "linear",
                    position: "left",
                    ticks: {
                        color: "#aaaaaa",
                        callback: function(value) {
                            return value.toFixed(1) + "%";
                        }
                    },
                    grid: { color: "#333333"},
                    border: { dash: [4, 4]} 
                }
            },
            plugins: {
                annotation: {
                    annotations: {}
                }
            } 
        }
    });
    return chart;
}

const chart = initChart();

//Buttons code
const generateBtn = document.getElementById("btn-generate");
console.log(generateBtn);

generateBtn.addEventListener("click", function() {
    const instrument = document.getElementById("instrument").value;
    document.getElementById("synthetic-warning").style.display = instrument === "DEMO" ? "block" : "none";
    chart.options.plugins.annotation.annotations = {};
    const leverage = Number(document.getElementById("leverage").value);
    const direction = document.getElementById("direction").value;
    const capital = Number(document.getElementById("capital").value);
    const expiry = Number(document.getElementById("expiry").value);
    const startDate = document.getElementById("start-date").value;
    const fee_management = document.getElementById("fee-management").value;
    const gap_premium = document.getElementById("gap-premium").value;
    const funding_cost = document.getElementById("funding-cost").value;
    const rebalancing_cost = document.getElementById("rebalancing-cost").value;
    const dailyManagementFee = Number(fee_management) / 252 / 100;
    const dailyGapPremium = Number(gap_premium) / 252 / 100;
    const dailyFundingCost = Number(funding_cost) / 252 / 100;
    const dailyRebalancingCost = Number(rebalancing_cost) / 252 / 100;
    console.log(instrument, leverage, direction, capital, expiry, dailyManagementFee, dailyGapPremium, dailyFundingCost, dailyRebalancingCost);
    
    document.getElementById("loading-indicator").style.display = "block";
    const instrumentType = INSTRUMENT_TYPE[instrument];
    const trigger = AIRBAG_TRIGGERS[instrumentType][leverage][direction];
    console.log(trigger);
    
    //data Fetching
    const path = `data/${instrument}.csv`;
    fetch(path)
        .then(response => response.text())
        .then(text => {
            const rows = text.split("\n");
            const header = rows[0];
            const dataRows = rows.slice(1).filter(row => row.length > 0);
            const candles = dataRows.map(row => {
                const cols = row.split(",");
                return {
                    datetime: cols[0],
                    open: Number(cols[1]),
                    high: Number(cols[2]),
                    low: Number(cols[3]),
                    close: Number(cols[4])
                };
            });
            console.log(candles[0]);
            console.log(candles[candles.length - 1]);

            const groupedDays = groupByDay(candles);
            console.log(Object.keys(groupedDays).length);
            const allDays = Object.keys(groupedDays);
            
            let startIndex = allDays.indexOf(startDate);
            if (startIndex === -1) {
                startIndex = allDays.findIndex(day => day >= startDate);
            }
            const safeStart = startIndex === -1 ? 0 : startIndex;
            const selectedDays = allDays.slice(safeStart, safeStart + expiry);
            
            console.log(selectedDays);

            let dlcValue = capital;
            let results = [];
            let dlcValueNoAirbag = capital;
            let airbagEvents = [];

            const startUnderlying = groupedDays[selectedDays[0]][0].close;
            const startDLC = capital;
            let totalFeesDeducted = 0;

            //DLC computing
            selectedDays.forEach(day => {
                const dayCandles = groupedDays[day];
                const dayOpen = dayCandles[0].close;
                let referenceLevel = dayOpen;
                let prevClose = dayOpen;
                let airbagActive = false;
                let airbagEndTime = null;
                
                //Airbag mechanism
                dayCandles.forEach(candle => {
                    const underlyingMove = (candle.close - prevClose) / prevClose;
                    const airbagMove = (candle.close - referenceLevel) / referenceLevel;
                    if (!airbagActive && ((direction === "long" && airbagMove <= trigger) ||
                    (direction === "short" && airbagMove >= trigger))) {
                        airbagActive = true;
                        airbagEndTime = new Date(new Date(candle.datetime).getTime() + 30 * 60 * 1000);
                        referenceLevel = candle.close;

                        airbagEvents.push({
                            datetime: candle.datetime,
                            level: candle.close,
                            move: (airbagMove * 100).toFixed(2),
                            endTime: formatLocalDateTime(airbagEndTime)
                        });
                    }
                    if (airbagActive && new Date(candle.datetime) >= airbagEndTime) {
                        airbagActive = false;
                        airbagEndTime = null;
                        referenceLevel = candle.close;
                    }
                    
                    let dlcMove = 0;
                    if (!airbagActive) {
                        if (direction === "long") {
                            dlcMove = underlyingMove * leverage;
                        } else {
                            dlcMove = -underlyingMove * leverage;
                        }
                        dlcValue = dlcValue * (1 + dlcMove);
                    }
                    
                    //Price movement without Airbag mechanism
                    let dlcMoveNoAirbag;
                    if (direction === "long") {
                        dlcMoveNoAirbag = underlyingMove * leverage;
                    } else {
                        dlcMoveNoAirbag = -underlyingMove * leverage;
                    }
                    dlcValueNoAirbag = dlcValueNoAirbag * (1 + dlcMoveNoAirbag);
                    if (dlcValueNoAirbag < 0) dlcValueNoAirbag = 0;

                    //Results
                    results.push({
                        datetime: candle.datetime,
                        underlying: (candle.close - startUnderlying) / startUnderlying * 100,
                        dlcValue: (dlcValue - startDLC) / startDLC * 100,
                        dlcValueNoAirbag: (dlcValueNoAirbag - startDLC) / startDLC * 100
                    });
                    prevClose = candle.close;
                });
 
                //Fee deductions
                const isLastDay = (day === selectedDays[selectedDays.length - 1]);
                let totalDailyFee;
                if (isLastDay) {
                    totalDailyFee = dailyManagementFee + dailyRebalancingCost;
                } else {
                    totalDailyFee = dailyFundingCost + dailyGapPremium + dailyManagementFee + dailyRebalancingCost;
                }
                totalFeesDeducted += dlcValue * totalDailyFee;
                dlcValue = dlcValue * (1-totalDailyFee);
                dlcValueNoAirbag = dlcValueNoAirbag * (1 - totalDailyFee);
            })
            console.log("Airbag events:", airbagEvents.length, airbagEvents);
            console.log(results[results.length - 1]);

            //Chart axis creation
            chart.data.datasets[0].data = results.map(r => ({
                x: r.datetime,
                y: r.underlying
            }));
            chart.data.datasets[1].data = results.map(r => ({
                x: r.datetime,
                y: r.dlcValue
            }));
            chart.data.datasets[2].data = results.map(r => ({
                x: r.datetime,
                y: r.dlcValueNoAirbag
            }));
            chart.options.scales.x.expiry = expiry;
            document.getElementById("chart-title").textContent =
                `${instrument} - ${leverage}x ${direction.charAt(0).toUpperCase() + direction.slice(1)} | ${selectedDays[0]} → ${selectedDays[selectedDays.length - 1]}`;
            chart.data.datasets[2].hidden = airbagEvents.length === 0;
            
            //Airbag Colored Area
            const annotationBoxes = {};
            airbagEvents.forEach((event, index) => {
                annotationBoxes[`box${index}`] = {
                    type: "box",
                    xMin: event.datetime,
                    xMax: event.endTime,
                    backgroundColor: "rgba(255, 153, 0, 0.15)",
                    borderColor: "rgba(255, 153, 0, 0.4)",
                    borderWidth: 1,
                    label: {
                        display: true,
                        content: ["Airbag", "Active"],
                        position: { x: "center", y:"start" },
                        color: "#ffcc66",
                        font: { size: 10, weight: "bold" },
                        textAlign: "center",
                    }
                };
            });
            chart.options.plugins.annotation.annotations = annotationBoxes;

            chart.update();
            document.getElementById("loading-indicator").style.display = "none";

            //Data in logs
            const statsContent = document.getElementById("stats-content");
            if (airbagEvents.length === 0) {
                statsContent.innerHTML = "<p style='color:#aaaaaa'>No airbag events triggered in this period. </p>";
            } else {
                let logHTML = "";
                airbagEvents.forEach(event => {
                    logHTML += `<p> ! <b> Airbag triggered</b> - ${event.datetime} | Underlying at ${event.level.toFixed(2)} | Move from open: ${event.move}%</p>`;
                });
                statsContent.innerHTML = logHTML;
            }

            //Summary Table
            const finalResult = results[results.length - 1];
            const tableContent = document.getElementById("table-content");
            tableContent.innerHTML = `
                <table>
                    <tr><th>Metric</th><th>Return</th></tr>
                    <tr><td>Underlying</td>
                        <td style="color:${finalResult.underlying >= 0 ? '#00cc66' : '#E60028'}; font-weight:bold">
                        ${finalResult.underlying.toFixed(2)}%</td></tr>
                    <tr><td>DLC with Airbag</td>
                        <td style="color:${finalResult.dlcValue >= 0 ? '#00cc66' : '#E60028'}; font-weight:bold">
                        ${finalResult.dlcValue.toFixed(2)}%</td></tr>
                    <tr><td>DLC without Airbag</td>
                        <td style="color:${finalResult.dlcValueNoAirbag >= 0 ? '#00cc66' : '#E60028'}; font-weight:bold">
                        ${finalResult.dlcValueNoAirbag.toFixed(2)}%</td></tr>
                    <tr><td>Total Fees</td>
                        <td style="color:#aaaaaa">
                        SGD ${totalFeesDeducted.toFixed(2)} (${(totalFeesDeducted / capital * 100).toFixed(2)}%)</td></tr>
                </table>
            `;

            const naiveReturn = finalResult.underlying * leverage;
            const decayGap = finalResult.dlcValue - naiveReturn;
            const decayEl = document.getElementById("decay-tracker");
            decayEl.innerHTML = `DLC Return: <span style="color:${finalResult.dlcValue >= 0 ? '#00cc66' : '#E60028'}">${finalResult.dlcValue.toFixed(2)}% </span> &nbsp;|&nbsp; Naive ${leverage}x return: <span>${naiveReturn.toFixed(2)}%</span> </span> | Compounding effect: <span style="color:${decayGap >= 0 ? '#00cc66' : '#E60028'}">${decayGap.toFixed(2)}%</span>`
        });
})

//Reset Button
const resetBtn = document.getElementById("btn-reset");
resetBtn.addEventListener("click", function() {
        chart.data.datasets[0].data = [];
        chart.data.datasets[1].data = [];
        chart.data.datasets[2].data = [];
        chart.options.plugins.annotation.annotations = {};
        chart.update();
        document.getElementById("stats-content").innerHTML = "";
        document.getElementById("table-content").innerHTML = "";
        document.getElementById("decay-tracker").innerHTML = "";
        document.getElementById("synthetic-warning").style.display = "none";
    });

document.querySelectorAll(".preset-btn").forEach(btn => {
    btn.addEventListener("click", function() {
        document.querySelectorAll(".preset-btn").forEach(b => {
            b.classList.remove("active");
        })
        this.classList.add("active");
        
        if (this.dataset.instrument === "DEMO") {
            const existingOption = document.querySelector("#instrument option[value='DEMO']");
            if (!existingOption) {
                const newOption = document.createElement("option");
                newOption.value = "DEMO";
                newOption.textContent = "Demo Crash Scenario (Synthetic Data)"
                document.getElementById("instrument").appendChild(newOption);
            }
        }
        document.getElementById("instrument").value = this.dataset.instrument;
        document.getElementById("leverage").value = this.dataset.leverage;
        document.getElementById("direction").value = this.dataset.direction;
        document.getElementById("start-date").value = this.dataset.date;
        document.getElementById("expiry").value = this.dataset.expiry
    });
});

document.getElementById("instrument").addEventListener("change", function() {
    const isStock = INSTRUMENT_TYPE[this.value] === "stock";
    const leverageSelect = document.getElementById("leverage");
    const option7x = leverageSelect.querySelector("option[value='7']");
    option7x.disabled = isStock;
    if (isStock && leverageSelect.value === "7") {
        leverageSelect.value = "5";
    }
});

console.log(resetBtn);



