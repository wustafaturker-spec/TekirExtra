// Gerçek Sovos adaptörünün yalnız internal test ağına yönlendirildiği SOAP fixture'ı.
const http=require('node:http'),assert=require('node:assert/strict');
assert(/^[a-f0-9]{16}$/.test(process.env.TEKIR_TEST_EBELGE_NONCE||''));
const sends={},actions={};
const server=http.createServer(async(q,r)=>{
  if(q.method==='GET'&&q.url==='/health'){r.end('{"ready":true}');return;}
  if(q.method==='GET'&&q.url==='/proof'){r.setHeader('Content-Type','application/json');r.end(JSON.stringify({sends,actions}));return;}
  if(q.method!=='POST'||q.url!=='/'+process.env.TEKIR_TEST_EBELGE_NONCE){r.writeHead(404);r.end();return;}
  let xml='';for await(const chunk of q){xml+=chunk;if(xml.length>4*1024*1024){r.writeHead(413);r.end();return;}}
  const action=q.headers.soapaction;actions[action]=(actions[action]||0)+1;
  if(action==='sendInvoice'){
    const uuid=xml.match(/<fileName>([a-f0-9-]{36})\.zip<\/fileName>/)?.[1];
    if(!uuid){r.writeHead(400);r.end('fixture UUID eksik');return;}
    sends[uuid]=(sends[uuid]||0)+1;r.setHeader('Content-Type','text/xml');
    r.end('<Envelope><Body><Result>SUCCESS</Result><UUID>'+uuid+'</UUID></Body></Envelope>');return;
  }
  if(action==='getStatus'){r.setHeader('Content-Type','text/xml');r.end('<Envelope><Body><statusCode>150</statusCode></Body></Envelope>');return;}
  r.writeHead(400);r.end('Kapsam dışı SOAPAction');
});
server.listen(8080,'0.0.0.0');process.once('SIGTERM',()=>{server.closeAllConnections();server.close();});
