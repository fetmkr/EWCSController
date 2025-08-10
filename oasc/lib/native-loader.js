// lib/native-loader.js
// 이 파일만 require 사용
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// 네이티브 모듈 로드
export const native = require('../src/build/Release/sx_camera');