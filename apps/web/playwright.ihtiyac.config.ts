import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const web=process.env.F03_TEST_WEB_ROOT;
if(!web)throw Error('F03_TEST_WEB_ROOT ile hazır standalone web paketini belirtin');
const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
const evidence=resolve(__dirname,process.env.F03_TEST_EVIDENCE??'../../.release-candidates/f04-ihtiyac-20261019/tarayici');
const port=Number(process.env.F03_TEST_PORT??3127);
export default defineConfig({testDir:'./e2e',testMatch:'stok-ihtiyac.spec.ts',workers:1,retries:0,timeout:120000,expect:{timeout:30000},outputDir:evidence+'/artifacts',reporter:[['list'],['json',{outputFile:evidence+'/sonuc.json'}]],use:{baseURL:`http://127.0.0.1:${port}`,channel:'chrome',trace:'retain-on-failure'},webServer:{command:`node ${quote(web+'/server.js')}`,env:{NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:String(port),NODE_OPTIONS:'--max-old-space-size=768',OTURUM_ISARETI_SECRET:'crm-belge-playwright-session-secret-2026'},url:`http://127.0.0.1:${port}/giris`,reuseExistingServer:false,timeout:300000}});
