/** Packaged Android resources resolve inside the app, never against a computer host. */
export function publicAsset(path:string){return new URL(import.meta.env.BASE_URL+path.replace(/^\/+/,''),document.baseURI).href;}
