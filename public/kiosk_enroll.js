import { httpsCallable } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-functions.js";
import { showKioskPanel } from './kiosk.js';

let inactivityTimer;

export function initEnrollmentPage(db, functions) {
    const video = document.getElementById('video');
    const enrollmentPanel = document.getElementById('enrollment-panel');
    const startButton = document.getElementById('start-enrollment-button');
    const tokenInput = document.getElementById('enrollment-token');
    const statusText = document.getElementById('enrollment-status');
    const faceOverlay = document.getElementById('face-overlay');
    const backToKioskButton = document.getElementById('back-to-kiosk-button');
    
    let modelsLoaded = false;
    
    // face-api.jsのモデルを読み込む
    async function loadModels() {
        if (modelsLoaded) return;
        const MODEL_URL = '/weights'; // モデルファイルが置いてあるパス
        try {
            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
                faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
            ]);
            modelsLoaded = true;
            console.log("顔認識モデルの読み込み完了");
        } catch (error) {
            console.error("モデルの読み込みに失敗:", error);
            statusText.textContent = 'エラー: モデル読込失敗';
        }
    }

    // カメラを起動する
    async function startCamera() {
        if (!modelsLoaded) await loadModels();
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
            video.srcObject = stream;
            resetInactivityTimer(); // カメラ起動時にタイマー開始
        } catch (err) {
            console.error("カメラの起動に失敗:", err);
            statusText.textContent = 'エラー: カメラ起動失敗';
        }
    }

    // 無操作タイムアウト処理
    function resetInactivityTimer() {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
            console.log("無操作状態が1分続いたため、キオスク画面に戻ります。");
            showKioskPanel();
        }, 60 * 1000); // 1分
    }

    // 登録画面のイベントリスナー
    enrollmentPanel.addEventListener('mousemove', resetInactivityTimer);
    enrollmentPanel.addEventListener('keypress', resetInactivityTimer);

    // 戻るボタンのクリックイベント
    if (backToKioskButton) {
        backToKioskButton.addEventListener('click', () => {
            clearTimeout(inactivityTimer); // タイマーをクリア
            showKioskPanel();
        });
    }

    // 外部からカメラ起動のイベントを受け取る
    document.addEventListener('start-camera', startCamera);

    startButton.addEventListener('click', async () => {
        const token = tokenInput.value;
        if (!token) {
            statusText.textContent = 'トークンを入力してください。';
            return;
        }

        faceOverlay.classList.remove('success', 'failure');
        startButton.disabled = true;

        try {
            // --- ここからが新しい実装 ---

            const CAPTURE_COUNT = 3; // 撮影する枚数
            const descriptors = [];    // 取得した特徴量データを保存する配列
            
            // ユーザーに撮影時のポーズを指示するためのテキスト
            const prompts = [
                "正面をまっすぐ向いてください...",
                "次は、顔を少しだけ左に向けてください...",
                "最後に、顔を少しだけ右に向けてください..."
            ];

            // 設定した回数だけループして顔を撮影する
            for (let i = 0; i < CAPTURE_COUNT; i++) {
                statusText.textContent = `${i + 1} / ${CAPTURE_COUNT} : ${prompts[i]}`;
                
                // ユーザーがポーズをとるための短い待機時間
                await new Promise(resolve => setTimeout(resolve, 3000)); 

                const detection = await faceapi.detectSingleFace(video, new faceapi.SsdMobilenetv1Options()) // 高精度モデルを推奨
                                              .withFaceLandmarks()
                                              .withFaceDescriptor();

                // 顔が検出できなかった場合は処理を中断する
                if (!detection) {
                    statusText.textContent = `顔が検出できませんでした。もう一度最初からやり直してください。`;
                    faceOverlay.classList.add('failure');
                    return; // finallyブロックが実行される
                }

                // 検出成功したら特徴量データを配列に保存
                descriptors.push(detection.descriptor);
            }

            // --- 撮影した特徴量を平均化する処理 ---
            statusText.textContent = '特徴を平均化しています...';
            
            // 平均化された特徴量を格納するための配列を用意 (128次元)
            const averageDescriptor = new Float32Array(128);

            // descriptors配列内のすべての特徴量を合計する
            for (const descriptor of descriptors) {
                for (let i = 0; i < descriptor.length; i++) {
                    averageDescriptor[i] += descriptor[i];
                }
            }
            
            // 合計値を撮影枚数で割り、平均を算出する
            for (let i = 0; i < averageDescriptor.length; i++) {
                averageDescriptor[i] /= CAPTURE_COUNT;
            }

            // --- 平均化したデータをサーバーに登録する ---
            statusText.textContent = '顔を検出しました。サーバーに登録しています...';
            faceOverlay.classList.add('success');

            const templateData = Array.from(averageDescriptor);
            const registerBiometric = httpsCallable(functions, 'registerBiometric');
            const result = await registerBiometric({ token, templateData });
            
            statusText.textContent = result.data.result;
            clearTimeout(inactivityTimer);
            setTimeout(showKioskPanel, 3000);

        } catch (error) {
            console.error("登録エラー:", error);
            statusText.textContent = `エラー: ${error.message}`;
            faceOverlay.classList.add('failure');
        } finally {
            // 処理が成功しても失敗してもボタンを再度有効にする
            startButton.disabled = false;
        }
    });
}