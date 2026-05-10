// ONNX inference worker. Per-frame post-processing runs in a WebAssembly
// module compiled from Rust (see wasm/ → pp/).
importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/ort.min.js');
importScripts('pp/cmrseg_pp.js');

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.0/dist/';
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

let session = null;
let contrast = null;
let includeMvo = true;   // overridable via 'set_include_mvo' message
// PP_FINAL — mirrors Scar/scar_experiments.py. All 2D, per-slice.
const K_SCAR = 20;
const K_MVO = 15;
const ppReady = wasm_bindgen('pp/cmrseg_pp_bg.wasm');

self.onmessage = async (e) => {
    const msg = e.data;

    if (msg.type === 'load') {
        try {
            await ppReady;
            session = await ort.InferenceSession.create(msg.modelBuffer, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
            });
            contrast = msg.contrast || null;
            if (typeof msg.includeMvo === 'boolean') includeMvo = msg.includeMvo;
            self.postMessage({ type: 'loaded' });
        } catch (err) {
            self.postMessage({ type: 'load_error', error: err.message });
        }
        return;
    }

    if (msg.type === 'set_contrast') {
        contrast = msg.contrast;
        return;
    }

    if (msg.type === 'set_include_mvo') {
        includeMvo = !!msg.includeMvo;
        return;
    }


    if (msg.type === 'infer') {
        try {
            const wasmPrep = wasm_bindgen.preprocess(msg.pixels, msg.rows, msg.cols, msg.psY, msg.psX);
            // ort.Tensor's type check rejects the wasm-bindgen Float32Array directly
            // in some browsers; force a clean copy via constructor.
            const prep = new Float32Array(wasmPrep);
            const inputTensor = new ort.Tensor('float32', prep, [1, 1, 224, 224]);
            const inputName = session.inputNames[0];
            const outputName = session.outputNames[0];
            const results = await session.run({ [inputName]: inputTensor });
            const out = results[outputName];
            const outputData = out.data;
            const shape = out.dims;
            const numClasses = shape[1];
            const H = shape[2], W = shape[3];
            const labelMap = new Uint8Array(H * W);
            for (let i = 0; i < H * W; i++) {
                let maxVal = outputData[i], maxCh = 0;
                for (let c = 1; c < numClasses; c++) {
                    const v = outputData[c * H * W + i];
                    if (v > maxVal) { maxVal = v; maxCh = c; }
                }
                labelMap[i] = maxCh;
            }

            let cleaned;
            if (contrast === 'cine') cleaned = wasm_bindgen.postprocess_cine(labelMap, H, W);
            else if (contrast === 'scar') cleaned = wasm_bindgen.postprocess_scar_frame(labelMap, H, W, K_SCAR, K_MVO, includeMvo);
            else cleaned = labelMap;

            self.postMessage(
                { type: 'result', taskId: msg.taskId, labelMap: cleaned, H, W },
                [cleaned.buffer]
            );
        } catch (err) {
            self.postMessage({ type: 'infer_error', taskId: msg.taskId, error: err.message });
        }
        return;
    }
};
