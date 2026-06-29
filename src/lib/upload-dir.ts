import path from "node:path";

// Where the local image provider stores files. On the VPS, set UPLOAD_DIR to a
// persistent dir OUTSIDE the repo (e.g. /opt/sportsun-uploads) so a redeploy
// (git reset --hard) never wipes uploaded images.
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), ".uploads");
