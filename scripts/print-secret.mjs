// npm run secret：印一組夠長的隨機字串，給 .env 的 APP_SECRET／ADMIN_PASSWORD 用。
//
// 刻意只印到畫面、不自己寫進 .env：要寫哪個欄位、要不要覆蓋既有的值，是使用者的決定；
// APP_SECRET 一旦換掉，既有的券商憑證就解不開了，那不該由一支 script 幫忙決定。
import { randomBytes } from "node:crypto";

const length = Math.max(32, Math.min(128, Number(process.argv[2]) || 48));
// base64url：沒有 +/= 這些在 .env 或 shell 裡容易被誤解的字元。
const secret = randomBytes(Math.ceil((length * 3) / 4)).toString("base64url").slice(0, length);

console.log("");
console.log(`  ${secret}`);
console.log("");
console.log(`  （${secret.length} 字元。複製到 .env 的 APP_SECRET= 後面；ADMIN_PASSWORD 也可以用同樣方式產生。）`);
console.log("  APP_SECRET 換掉之後，先前存的券商憑證會解不開，需要重新輸入。");
console.log("");
