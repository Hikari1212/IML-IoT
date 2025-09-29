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
    
    let modelsLoaded = false;
    
    // face-api.jsのモデルを読み込む
    async function loadModels() {
        if (modelsLoaded) return;
        const MODEL_URL = '/weights'; // モデルファイルが置いてあるパス
        try {
            await Promise.all([
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

    // 外部からカメラ起動のイベントを受け取る
    document.addEventListener('start-camera', startCamera);

    startButton.addEventListener('click', async () => {
        const token = tokenInput.value;
        if (!token) {
            statusText.textContent = 'トークンを入力してください。';
            return;
        }

        statusText.textContent = '顔を検出しています...';
        faceOverlay.classList.remove('success', 'failure');
        startButton.disabled = true;

        try {
            const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
                                          .withFaceLandmarks()
                                          .withFaceDescriptor();

            if (!detection) {
                statusText.textContent = '顔が検出できませんでした。もう一度試してください。';
                faceOverlay.classList.add('failure');
                return;
            }

            statusText.textContent = '顔を検出しました。サーバーに登録しています...';
            faceOverlay.classList.add('success');

            // Float32Arrayを通常の配列に変換してCloud Functionsに送信
            const templateData = Array.from(detection.descriptor);

            const registerBiometric = httpsCallable(functions, 'registerBiometric');
            const result = await registerBiometric({ token, templateData });
            
            statusText.textContent = result.data.result;
            clearTimeout(inactivityTimer); // 成功したのでタイマーを停止
            setTimeout(showKioskPanel, 3000); // 3秒後にキオスク画面に戻る

        } catch (error) {
            console.error("登録エラー:", error);
            statusText.textContent = `エラー: ${error.message}`;
            faceOverlay.classList.add('failure');
        } finally {
            startButton.disabled = false;
        }
    });
}