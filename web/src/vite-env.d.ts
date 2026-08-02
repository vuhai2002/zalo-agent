/// <reference types="vite/client" />

/**
 * Version của app, Vite thay bằng chuỗi thật lúc build (`define` trong
 * `vite.config.ts`, đọc từ `package.json` gốc). Khai ở đây để TypeScript biết
 * biến này tồn tại - nó không phải biến chạy thật, chỉ là chỗ được thay văn bản.
 */
declare const __APP_VERSION__: string;
