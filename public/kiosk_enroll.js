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
    
    async function loadModels() {
        if (modelsLoaded) return;
        const MODEL_URL = '/weights';
        try {
            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
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

    async function startCamera() {
        if (!modelsLoaded) await loadModels();
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
            video.srcObject = stream;
            resetInactivityTimer();
        } catch (err) {
            console.error("カメラの起動に失敗:", err);
            statusText.textContent = 'エラー: カメラ起動失敗';
        }
    }

    function resetInactivityTimer() {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
            console.log("無操作状態が1分続いたため、キオスク画面に戻ります。");
            showKioskPanel();
        }, 60 * 1000);
    }

    enrollmentPanel.addEventListener('mousemove', resetInactivityTimer);
    enrollmentPanel.addEventListener('keypress', resetInactivityTimer);

    if (backToKioskButton) {
        backToKioskButton.addEventListener('click', () => {
            clearTimeout(inactivityTimer);
            showKioskPanel();
        });
    }

    document.addEventListener('start-camera', startCamera);

    // ▼▼▼【修正点 1】品質チェック関数が理由を返すように変更 ▼▼▼
    function isGoodQuality(detection, videoElement) {
        if (!detection) {
            return { success: false, reason: "顔を検出できません..." };
        }
        const faceBox = detection.detection.box;
        const landmarks = detection.landmarks;
        const videoWidth = videoElement.clientWidth;
        const videoHeight = videoElement.clientHeight;

        if (videoWidth === 0 || videoHeight === 0) {
            return { success: false, reason: "カメラサイズ取得エラー" };
        }

        const faceArea = faceBox.width * faceBox.height;
        const videoArea = videoWidth * videoHeight;
        if ((faceArea / videoArea) < 0.20) {
            return { success: false, reason: "顔が小さすぎます。カメラに近づいてください。" };
        }

        const faceCenterX = faceBox.x + faceBox.width / 2;
        const faceCenterY = faceBox.y + faceBox.height / 2;
        const isHorizontallyCentered = faceCenterX > videoWidth * 0.25 && faceCenterX < videoWidth * 0.75;
        const isVerticallyCentered = faceCenterY > videoHeight * 0.25 && faceCenterY < videoHeight * 0.75;
        if (!isHorizontallyCentered || !isVerticallyCentered) {
            return { success: false, reason: "顔が中央にありません。枠内に収めてください。" };
        }

        if (!landmarks.getLeftEye().length || !landmarks.getRightEye().length || !landmarks.getMouth().length) {
            return { success: false, reason: "目や口が隠れています。前髪やマスクを外してください。" };
        }
        
        return { success: true };
    }

    startButton.addEventListener('click', async () => {
        const token = tokenInput.value;
        if (!token) {
            statusText.textContent = 'トークンを入力してください。';
            return;
        }

        faceOverlay.classList.remove('success', 'failure');
        startButton.disabled = true;

        try {
            const CAPTURE_COUNT = 3;
            const descriptors = [];
            const prompts = [
                "正面をまっすぐ向いてください...",
                "次は、顔を少しだけ左に向けてください...",
                "最後に、顔を少しだけ右に向けてください..."
            ];

            for (let i = 0; i < CAPTURE_COUNT; i++) {
                statusText.textContent = `${i + 1} / ${CAPTURE_COUNT} : ${prompts[i]}`;
                
                let successfulShot = false;
                for (let attempt = 0; attempt < 50; attempt++) {
                    const detection = await faceapi.detectSingleFace(video, new faceapi.SsdMobilenetv1Options())
                                                  .withFaceLandmarks()
                                                  .withFaceDescriptor();
                    
                    // ▼▼▼【修正点 2】品質チェックの結果を画面に表示 ▼▼▼
                    const qualityCheck = isGoodQuality(detection, video);
                    
                    if (qualityCheck.success) {
                        descriptors.push(detection.descriptor);
                        successfulShot = true;
                        
                        faceOverlay.classList.add('success');
                        await new Promise(resolve => setTimeout(resolve, 200));
                        faceOverlay.classList.remove('success');
                        
                        break;
                    } else {
                        // 失敗理由をリアルタイムで表示
                        statusText.textContent = qualityCheck.reason;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                if (!successfulShot) {
                    statusText.textContent = `良い品質の顔が検出できませんでした。撮影環境を確認してください。`;
                    faceOverlay.classList.add('failure');
                    return;
                }
            }

            statusText.textContent = '特徴を平均化しています...';
            const averageDescriptor = new Float32Array(128);
            for (const descriptor of descriptors) {
                for (let i = 0; i < descriptor.length; i++) {
                    averageDescriptor[i] += descriptor[i];
                }
            }
            for (let i = 0; i < averageDescriptor.length; i++) {
                averageDescriptor[i] /= CAPTURE_COUNT;
            }

            statusText.textContent = 'サーバーに登録しています...';
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
            startButton.disabled = false;
        }
    });
}