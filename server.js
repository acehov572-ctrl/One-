const express=require("express");
const {chromium}=require("playwright");
const app=express(); app.use(express.json({limit:"2mb"})); app.use(express.static("public"));
const PORT=process.env.PORT||10000;
const SOURCES=["https://fonbet.com/live","https://fonbet.com/live/sports-simulators","https://fon.bet/live"];

function norm(s){return String(s||"").replace(/\u00a0/g," ").replace(/[ \t]+/g," ").trim();}
function parseMatches(text,source){
  const lines=String(text||"").split(/\n+/).map(norm).filter(Boolean);
  const out=[]; let inFc=false;
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(/FC\s*26/i.test(line) || /United Esports/i.test(line) || /Лига\s*Про-1/i.test(line)) inFc=true;
    if(inFc && (/FC\s*26/i.test(line)||/Лига\s*Про-1/i.test(line))){
      const competition=line;
      for(let j=i+1;j<Math.min(lines.length,i+15);j++){
        const l=lines[j];
        const m=l.match(/^(.+?)\s*[-–—]\s*(.+)$/);
        if(!m) continue;
        let k=j+1, time=null, score=null;
        for(;k<Math.min(lines.length,j+5);k++){
          if(!time && /^(?:Not started|Finished|\d{1,3}:\d{2})$/i.test(lines[k])) time=lines[k];
          if(!score && /^(\d{1,2})\s*:\s*(\d{1,2})$/.test(lines[k])) score=lines[k];
          if(time&&score) break;
        }
        if(time&&score){
          const sm=score.match(/(\d+)\s*:\s*(\d+)/);
          out.push({competition,home:m[1].trim(),away:m[2].trim(),time,score,homeScore:+sm[1],awayScore:+sm[2],source});
          j=k;
        }
      }
      inFc=false;
    }
  }
  // de-duplicate
  const seen=new Set(); return out.filter(x=>{const k=[x.home,x.away,x.score,x.time].join("|");if(seen.has(k))return false;seen.add(k);return true});
}
function poisson(lambda,k){let r=Math.exp(-lambda);for(let i=1;i<=k;i++)r*=lambda/i;return r}
function prediction(minute,h,a){
  const total=h+a, rem=Math.max(0,8-minute);
  const lambda=Math.max(.08,1.05*(rem/8)+(total>=3?.12:total===2?.05:0));
  const goal=(1-Math.exp(-lambda))*100;
  const p=(line)=>{const need=Math.floor(line-total)+1;if(need<=0)return 100;let s=0;for(let k=0;k<need;k++)s+=poisson(lambda,k);return (1-s)*100};
  return {lambda:+lambda.toFixed(2),goalProbability:+goal.toFixed(1),over05:+p(.5).toFixed(1),over15:+p(1.5).toFixed(1),over25:+p(2.5).toFixed(1),over35:+p(3.5).toFixed(1)};
}
function minuteFromTime(t){const m=String(t).match(/^(\d{1,3}):(\d{2})$/);return m?Math.min(8,Math.max(0,Math.round(+m[1]/60*8))):null}

async function readSource(url){
  let browser; const started=Date.now();
  try{
    browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
    const ctx=await browser.newContext({locale:"ru-RU",userAgent:"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36"});
    const page=await ctx.newPage();
    const resp=await page.goto(url,{waitUntil:"domcontentloaded",timeout:30000}).catch(()=>null);
    await page.waitForTimeout(2500);
    const body=await page.locator("body").innerText({timeout:8000}).catch(()=> "");
    return {url,status:resp?.status()||null,title:await page.title().catch(()=>""),body,ms:Date.now()-started,finalUrl:page.url()};
  }finally{if(browser)await browser.close().catch(()=>{})}
}
async function collect(){
  const reports=[];
  for(const url of SOURCES){
    try{
      const r=await readSource(url); const matches=parseMatches(r.body,r.url);
      reports.push({url:r.url,status:r.status,title:r.title,finalUrl:r.finalUrl,chars:r.body.length,ms:r.ms,matches});
      if(matches.length) return {ok:true,source:r.url,matches,reports};
    }catch(e){reports.push({url,status:null,error:e.message,matches:[]})}
  }
  return {ok:false,matches:[],reports,message:"FC26 матчей не найдено. Возможно, источник временно защищён или изменил разметку."};
}
app.get("/api/health",(q,s)=>s.json({ok:true,version:"14.0"}));
app.get("/api/live",async(q,s)=>{try{s.json(await collect())}catch(e){s.status(500).json({ok:false,message:e.message})}});
app.get("/api/demo",(q,s)=>s.json({ok:true,source:"demo",matches:[
 {competition:"FC 26. United Esports Leagues. 2X3 min. Czech Republic",home:"Germany (Jiraz)",away:"Netherlands (Shooter)",time:"88:00",score:"1:0",homeScore:1,awayScore:0}
]}));
app.listen(PORT,"0.0.0.0",()=>console.log("FC26 14 on "+PORT));
