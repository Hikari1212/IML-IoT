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
    const instructionOverlay = document.getElementById('face-instruction-overlay');
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

    // ▼▼▼【修正点1】品質チェックに明るさ判定を追加 ▼▼▼
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
        
        try {
            const canvas = document.createElement('canvas');
            canvas.width = videoWidth;
            canvas.height = videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(videoElement, 0, 0, videoWidth, videoHeight);
            const imageData = ctx.getImageData(0, 0, videoWidth, videoHeight).data;
            
            let totalBrightness = 0;
            for (let i = 0; i < imageData.length; i += 4) {
                const brightness = (imageData[i] + imageData[i + 1] + imageData[i + 2]) / 3;
                totalBrightness += brightness;
            }
            const avgBrightness = totalBrightness / (imageData.length / 4);

            if (avgBrightness < 50) {
                return { success: false, reason: "暗すぎます。明るい場所で試してください。" };
            }
            if (avgBrightness > 200) {
                return { success: false, reason: "明るすぎます。逆光を避けてください。" };
            }
        } catch (e) {
            console.warn("明るさのチェックに失敗:", e);
        }
        
        return { success: true };
    }

    // ▼▼▼【修正点2】顔登録処理に指示表示を追加 ▼▼▼
    startButton.addEventListener('click', async () => {
        const token = tokenInput.value;
        if (!token) {
            statusText.textContent = 'トークンを入力してください。';
            return;
        }

        faceOverlay.classList.remove('success', 'failure');
        startButton.disabled = true;
        instructionOverlay.textContent = '';
        instructionOverlay.classList.remove('visible');

        try {
            const CAPTURE_COUNT = 3;
            const descriptors = [];
            const prompts = [
                "正面をまっすぐ向いてください",
                "顔を少しだけ左に向けてください",
                "最後に、顔を右に向けてください"
            ];

            for (let i = 0; i < CAPTURE_COUNT; i++) {
                instructionOverlay.textContent = prompts[i];
                instructionOverlay.classList.add('visible');
                statusText.textContent = `(${i + 1}/${CAPTURE_COUNT}) 準備中...`;
                
                let successfulShot = false;
                for (let attempt = 0; attempt < 100; attempt++) {
                    const detection = await faceapi.detectSingleFace(video, new faceapi.SsdMobilenetv1Options())
                                                .withFaceLandmarks()
                                                .withFaceDescriptor();
                    
                    const qualityCheck = isGoodQuality(detection, video);
                    
                    if (qualityCheck.success) {
                        descriptors.push(detection.descriptor);
                        successfulShot = true;
                        
                        faceOverlay.classList.add('success');
                        await new Promise(resolve => setTimeout(resolve, 200));
                        faceOverlay.classList.remove('success');
                        
                        break;
                    } else {
                        statusText.textContent = `(${i + 1}/${CAPTURE_COUNT}) ${qualityCheck.reason}`;
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                instructionOverlay.classList.remove('visible');

                if (!successfulShot) {
                    statusText.textContent = `良い品質の顔が検出できませんでした。撮影環境を確認してください。`;
                    faceOverlay.classList.add('failure');
                    startButton.disabled = false;
                    return;
                }

                // ▼▼▼【ここに追加】撮影成功後に1.5秒のポーズを入れる ▼▼▼
                if (i < CAPTURE_COUNT - 1) { // 最後の撮影後はポーズしない
                    statusText.textContent = `OK! 次の準備をします...`;
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }

            statusText.textContent = 'サーバーに登録しています...';
            faceOverlay.classList.add('success');

            const templates = descriptors.map(d => Array.from(d));
            const registerBiometric = httpsCallable(functions, 'registerBiometric');
            const result = await registerBiometric({ token, templates });
            
            statusText.textContent = result.data.result;
            clearTimeout(inactivityTimer);
            setTimeout(showKioskPanel, 3000);

        } catch (error) {
            console.error("登録エラー:", error);
            statusText.textContent = `エラー: ${error.message}`;
            faceOverlay.classList.add('failure');
        } finally {
            startButton.disabled = false;
            instructionOverlay.classList.remove('visible');
        }
    });
}