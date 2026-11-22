/**
 * wasm_decrypt_worker.js
 * ─────────────────────────────────────────────────────────
 * Web Worker 環境向け WASM 復号モジュールラッパー
 * 
 * ES Module import が使えない Worker 環境で、
 * wasm-bindgen 生成のグルーコード (wasm_decrypt.js) と同等の
 * ABI 呼び出しを提供する。
 * 
 * wasm-bindgen v0.2.130 (externref テーブル方式) 対応
 * ─────────────────────────────────────────────────────────
 */

let wasm = null;
let wasmReady = false;
let cachedUint8ArrayMemory0 = null;
let WASM_VECTOR_LEN = 0;

const cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

/**
 * WASM モジュールを初期化する（Worker環境用）
 */
async function initWasmInWorker() {
    try {
        const wasmUrl = new URL('./wasm/wasm_decrypt_bg.wasm', self.location.href).href;
        const response = await fetch(wasmUrl);
        if (!response.ok) {
            throw new Error(`WASM fetch failed: ${response.status}`);
        }
        const wasmBytes = await response.arrayBuffer();

        // wasm-bindgen が要求する import オブジェクト
        const imports = {
            './wasm_decrypt_bg.js': {
                __wbindgen_generic_0000000000000001: function(arg0, arg1) {
                    return getStringFromWasm0(arg0, arg1);
                },
                __wbindgen_init_externref_table: function() {
                    const table = wasm.__wbindgen_externrefs;
                    table.set(0, undefined);
                    table.set(1024, undefined);
                    table.set(1025, null);
                    table.set(1026, true);
                    table.set(1027, false);
                },
            },
        };

        const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
        wasm = instance.exports;
        cachedUint8ArrayMemory0 = null;

        // wasm-bindgen の __wbindgen_start を呼び出す（初期化処理）
        if (wasm.__wbindgen_start) {
            wasm.__wbindgen_start();
        }

        wasmReady = true;
        console.log('[Worker][WASM] 復号モジュールの初期化が完了しました。');
    } catch (e) {
        console.error('[Worker][WASM] 復号モジュールの初期化に失敗:', e);
        wasmReady = false;
    }
}

/**
 * 暗号化データを復号する（Worker環境用）
 * @param {Uint8Array} encrypted - 暗号化されたバイナリデータ
 * @returns {string} 復号された CSV テキスト
 */
function decryptCsvDataInWorker(encrypted) {
    if (!wasmReady || !wasm) {
        throw new Error('WASM復号モジュールが初期化されていません。');
    }

    let deferred_0;
    let deferred_1;
    try {
        const ptr0 = passArray8ToWasm0(encrypted, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decrypt_csv_data(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred_0 = ptr2;
        deferred_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred_0, deferred_1, 1);
    }
}
