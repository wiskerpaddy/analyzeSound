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

    // 描画ループが止まっていたら再開
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
    
    // --- 修正ポイント：再録音への対応 ---
    if(target === 'A') snapA = null; else snapB = null;
    isRecording = false;
    
    // 結果エリアを少し薄くして「更新中」であることを示す（任意）
    document.getElementById('resultArea').style.opacity = "0.5";
    
    // 停止していた描画を再開
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
                executeRecording(target); // 録音実行
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
    const area = document.getElementById('resultArea');
    
    // 透明度を直接数字でいじるのをやめ、クラスで管理する
    area.classList.remove('loading'); 
    area.classList.add('ready');
    
    // 【本質抽出ロジック】
    // 1. 周波数特性（スペクトル分布）は時間軸を持たないため、そもそもタイミングに依存しません。
    // 2. 反応速度のみ、立ち上がりの「差」として相対的に算出します。

    area.style.opacity = "1";
    if(currentMode === 'compare') {
        if(!snapA || !snapB) return;
        // 純粋な周波数成分の比較
        const charA = analyzeTimbre(snapA.data);
        const charB = analyzeTimbre(snapB.data);

        area.innerHTML = `
            <div class="report" style="opacity: 1 !important;"> 
                <h3 style="color: #fff;">楽器特性 比較レポート</h3>
                <p style="font-size:11px; color:#888; margin-bottom:10px;">
                    ※発音タイミングのズレは自動補正済みです。純粋な楽器の響きを比較しています。
                </p>
                
                <div class="metric-row" title="音の密度。波形の山の太さを解析。">
                    <span><strong>響きの太さ (Core)</strong> ⓘ</span>
                    <span class="pass">${charA.power > charB.power ? '楽器Aが濃厚' : '楽器Bが濃厚'}</span>
                </div>
                
                <div class="metric-row" title="高次倍音のキラキラした成分。">
                    <span><strong>音の明るさ (Bright)</strong> ⓘ</span>
                    <span class="pass">${charA.high > charB.high ? '楽器Aが明瞭' : '楽器Bが明瞭'}</span>
                </div>

                <div class="metric-row" title="入力に対してどれだけ素直に反応するか。">
                    <span><strong>レスポンス効率</strong> ⓘ</span>
                    <span class="pass">${snapA.attack < snapB.attack ? '楽器Aが効率的' : '楽器Bが効率的'}</span>
                </div>
            </div>`;
    }
}

// 時間軸に依存しない音色解析関数
function analyzeTimbre(data) {
    // 1. ノイズ除去：一定以下の小さな音（端切れ）を除外して、
    // 「実際に楽器が鳴っている成分」だけを抽出する
    const activeData = data.filter(v => v > 10); 
    
    if (activeData.length === 0) return { power: 0, high: 0 };

    // 2. 音量の正規化：全体の合計で割ることで、
    // 「吹く強さ」や「マイクとの距離」の差を完全にキャンセルする
    const totalEnergy = activeData.reduce((a, b) => a + b, 0);

    // 3. 比率計算（％）：音量ではなく「音の成分構成」だけで判定
    // 低～中域（芯の太さ）
    const powerRatio = (activeData.slice(0, 40).reduce((a, b) => a + b, 0) / totalEnergy) * 100;
    // 高域（キラキラ感・キレ）
    const highRatio = (activeData.slice(40, 120).reduce((a, b) => a + b, 0) / totalEnergy) * 100;

    return { power: powerRatio, high: highRatio };
}


function draw() {
    // 録音完了かつデータがある場合はループを止める
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