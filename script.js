let audioCtx, analyser, dataArray;
let snapA = null, snapB = null;
let currentMode = 'compare';
let isRecording = false;
let animationId; // 描画ループ管理用

const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('modeCompare').onclick = () => switchMode('compare');
    document.getElementById('modeInspect').onclick = () => switchMode('inspect');
    document.getElementById('recA').onclick = () => startRecording('A');
    document.getElementById('recB').onclick = () => startRecording('B');
    document.getElementById('actionBtn').onclick = runAnalysis;
    document.getElementById('resetBtn').onclick = () => location.reload();
    switchMode('compare');
});

function switchMode(mode) {
    currentMode = mode;
    document.body.className = mode + '-mode';
    
    // 状態を完全にクリア
    snapA = null; 
    snapB = null;
    isRecording = false;
    document.getElementById('status').innerText = "STANDBY";
    document.getElementById('resultArea').innerHTML = '';
    
    // ボタンのテキストを初期化
    document.getElementById('recA').innerText = mode === 'inspect' ? '検査録音を開始' : 'Snapshot A 録音';
    document.getElementById('recB').innerText = 'Snapshot B 録音';
    document.getElementById('recB').style.display = mode === 'inspect' ? 'none' : 'block';

    if (!animationId && audioCtx) draw();
}

async function startRecording(target) {
    if(!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        source.connect(analyser);
    }
    
    if(target === 'A') snapA = null; else snapB = null;
    isRecording = false;
    document.getElementById('resultArea').style.opacity = "0.5";
    
    if(!animationId) draw();

    const overlay = document.getElementById('overlay');
    overlay.style.display = 'flex';
    let count = 3;
    overlay.innerText = count;

    const timer = setInterval(() => {
        count--;
        if(count > 0) overlay.innerText = count;
        else {
            clearInterval(timer);
            overlay.innerText = "START!";
            setTimeout(() => {
                overlay.style.display = 'none';
                executeRecording(target); 
            }, 500);
        }
    }, 1000);
}

function executeRecording(target) {
    isRecording = true;
    document.getElementById('status').innerText = "RECORDING...";
    let samples = [];
    let start = Date.now();
    let attack = 0;

    const interval = setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        samples.push(new Uint8Array(dataArray));
        if(Math.max(...dataArray) > 150 && attack === 0) attack = Date.now() - start;

        if(samples.length >= 75) {
            clearInterval(interval);
            let avg = new Float32Array(analyser.frequencyBinCount);
            for(let i=0; i<avg.length; i++) avg[i] = samples.reduce((s, a) => s + a[i], 0) / samples.length;
            
            if(target === 'A') snapA = {data: avg, attack};
            else snapB = {data: avg, attack};
            
            isRecording = false;
            document.getElementById('status').innerText = "DONE";
            const btn = document.getElementById(target === 'A' ? 'recA' : 'recB');
            btn.innerText = (currentMode === 'inspect' ? "検査録音" : "Snapshot " + target) + " [完了]";
        }
    }, 40);
}

function runAnalysis() {
    if (currentMode === 'compare') {
        if (!snapA || !snapB) {
            alert("比較には Snapshot A と B 両方の録音が必要です。");
            return;
        }
    } else {
        if (!snapA) {
            alert("検査用の録音が完了していません。");
            return;
        }
    }

    const resultArea = document.getElementById('resultArea');
    resultArea.innerHTML = '<div class="loading">解析中...</div>';
    resultArea.style.opacity = "1";

    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    setTimeout(() => {
        if (currentMode === 'compare') {
            displayCompareResult();
        } else {
            displayInspectResult();
        }
    }, 500);
}

function displayCompareResult() {
    const area = document.getElementById('resultArea');
    // analyzeSpectrum ではなく analyzeTimbre を使用
    const charA = analyzeTimbre(snapA.data);
    const charB = analyzeTimbre(snapB.data);

    area.innerHTML = `
        <div class="report" style="opacity: 1 !important;"> 
            <h3 style="color: #fff;">楽器特性 比較レポート</h3>
            <p style="font-size:11px; color:#888; margin-bottom:10px;">
                ※AとBの周波数特性を対比解析しました。
            </p>
            <div class="metric-row">
                <span><strong>響きの太さ (Core)</strong></span>
                <span class="pass">${charA.power > charB.power ? '楽器Aが濃厚' : '楽器Bが濃厚'}</span>
            </div>
            <div class="metric-row">
                <span><strong>音の明るさ (Bright)</strong></span>
                <span class="pass">${charA.high > charB.high ? '楽器Aが明瞭' : '楽器Bが明瞭'}</span>
            </div>
            <div class="metric-row">
                <span><strong>レスポンス効率</strong></span>
                <span class="pass">${(snapA.attack || 0) < (snapB.attack || 0) ? '楽器Aが俊敏' : '楽器Bが俊敏'}</span>
            </div>
        </div>`;
}

function displayInspectResult() {
    const area = document.getElementById('resultArea');
    // analyzeSpectrum ではなく analyzeTimbre を使用
    const charA = analyzeTimbre(snapA.data);
    
    area.innerHTML = `
        <div class="report" style="opacity: 1 !important;"> 
            <h3 style="color: #fff;">楽器特性 検査レポート</h3>
            <p style="font-size:11px; color:#888; margin-bottom:10px;">
                ※単体の響きを精密解析した結果です。
            </p>
            <div class="metric-row">
                <span><strong>響きの太さ (Core)</strong></span>
                <span class="pass">${charA.power.toFixed(1)} %</span>
            </div>
            <div class="metric-row">
                <span><strong>音の明るさ (Bright)</strong></span>
                <span class="pass">${charA.high.toFixed(1)} %</span>
            </div>
            <div class="metric-row">
                <span><strong>レスポンス強度</strong></span>
                <span class="pass">${(100 - (snapA.attack || 0)).toFixed(1)} %</span>
            </div>
            <div style="margin-top:15px; padding-top:10px; border-top:1px solid #444;">
                <p style="font-size:12px; color:#ddd;">
                    【特性診断】: ${charA.power > 25 ? '中低域に芯がある、力強い個体です。' : '高域まで素直に伸びる、繊細な個体です。'}
                </p>
            </div>
        </div>`;
}

function analyzeTimbre(data) {
    const activeData = data.filter(v => v > 10); 
    if (activeData.length === 0) return { power: 0, high: 0 };
    const totalEnergy = activeData.reduce((a, b) => a + b, 0);

    const powerRatio = (activeData.slice(0, 40).reduce((a, b) => a + b, 0) / totalEnergy) * 100;
    const highRatio = (activeData.slice(40, 120).reduce((a, b) => a + b, 0) / totalEnergy) * 100;

    return { power: powerRatio, high: highRatio };
}

function draw() {
    if (!isRecording && (snapA || snapB) && currentMode === 'inspect') {
        cancelAnimationFrame(animationId);
        animationId = null;
        return;
    }
    animationId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if(snapA) drawLine(snapA.data, '#2196f3', 2);
    if(snapB) drawLine(snapB.data, '#ff5252', 2);
    if(isRecording || (!snapA && !snapB)) drawLine(dataArray, '#fff', 1);
}

function drawLine(data, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    let slice = canvas.width / (data.length / 4);
    for(let i=0; i<data.length/4; i++) {
        let y = canvas.height - (data[i]/255 * canvas.height);
        if(i===0) ctx.moveTo(0, y); else ctx.lineTo(i*slice, y);
    }
    ctx.stroke();
}

// 簡易的なパワー計算（芯の強さ）
function calculatePower(data) {
    return data.slice(0, 20).reduce((a, b) => a + b, 0); 
}

// 簡易的なエッジ計算（ぱきっと感）
function calculateEdge(data) {
    return data.slice(40, 100).reduce((a, b) => a + b, 0);
}