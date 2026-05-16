// Types for the Emscripten-generated Node IMBE module (built by
// ../web-console/cpp/build-vocoder.sh).

interface ImbeWasmModule {
  _imbe_init(): number;
  _imbe_encode(samplesPtr: number, codewordPtr: number): number;
  _imbe_decode(codewordPtr: number, samplesPtr: number): number;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  HEAP16: Int16Array;
  HEAPU8: Uint8Array;
}

declare const createImbeModule: (options?: Record<string, unknown>) => Promise<ImbeWasmModule>;
export default createImbeModule;
