// Yalnız izole worker kabulü için; host portu yayımlanmaz.
const net=require('node:net'),http=require('node:http'),assert=require('node:assert/strict');
assert(/^[a-f0-9]{16}$/.test(process.env.TEKIR_TEST_SMTP_NONCE||''));
const messages=[],sockets=new Set();
const smtp=net.createServer(socket=>{
 sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
 let buffer='',data=false,raw='';socket.write('220 fixture SMTP\r\n');
 socket.on('data',chunk=>{
  buffer+=chunk.toString();if(buffer.length+raw.length>4*1024*1024){socket.destroy();return;}
  let end;while((end=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
   if(data){if(line==='.'){messages.push(raw);raw='';data=false;socket.write('250 accepted\r\n');}else raw+=(line.startsWith('..')?line.slice(1):line)+'\r\n';continue;}
   if(/^(EHLO|HELO)\b/.test(line))socket.write('250-fixture\r\n250 8BITMIME\r\n');
   else if(line==='DATA'){data=true;socket.write('354 continue\r\n');}
   else if(line==='QUIT')socket.end('221 bye\r\n');else socket.write('250 ok\r\n');
  }
 });
});
const api=http.createServer((q,r)=>{r.setHeader('Content-Type','application/json');if(q.url==='/messages')r.end(JSON.stringify(messages));else if(q.url==='/health')r.end('{"ready":true}');else{r.statusCode=404;r.end('{}');}});
smtp.listen(1025,'0.0.0.0');api.listen(8025,'0.0.0.0');
process.once('SIGTERM',()=>{for(const s of sockets)s.destroy();smtp.close();api.close();});
