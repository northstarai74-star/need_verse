// Prints a new secret for admin two-factor sign in. Add it to .env as ADMIN_TOTP_SECRET,
// then scan the otpauth link (or type the secret) into Google Authenticator, Authy or 1Password.
//   npm run totp
const { newTotpSecret } = require("./lib/security");
const secret = newTotpSecret();
const user = process.env.ADMIN_USER || "admin";
console.log(`\nADMIN_TOTP_SECRET=${secret}\n`);
console.log(`Authenticator link: otpauth://totp/Needverse:${encodeURIComponent(user)}?secret=${secret}&issuer=Needverse&digits=6&period=30\n`);
