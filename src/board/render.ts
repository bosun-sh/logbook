import type { Task } from "@logbook/task/schema.js"

export type BoardPageData = {
  readonly generatedAt: string
  readonly boards: { readonly label: string; readonly tasks: readonly Task[] }[]
  readonly warnings: { readonly label: string; readonly message: string }[]
}

const CSS = `
:root{color-scheme:light dark;--bg:#f6f6f4;--fg:#1c1c1a;--mut:#6b6b66;--card:#fff;--bd:#d9d9d3;--acc:#b4531a;--warn:#fff3cd}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecece8;--mut:#9a9a92;--card:#222220;--bd:#3a3a36;--acc:#e8935a;--warn:#4a3d12}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{padding:12px 16px;border-bottom:1px solid var(--bd);display:flex;flex-wrap:wrap;gap:12px;align-items:center}
h1{font-size:16px;margin:0}#counts{color:var(--mut);flex:1}
select,input{font:inherit;padding:4px 8px;background:var(--card);color:var(--fg);border:1px solid var(--bd);border-radius:4px}
#warnings{margin:0;padding:0;list-style:none}#warnings li{background:var(--warn);padding:8px 16px;border-bottom:1px solid var(--bd)}
main{display:flex;gap:12px;padding:16px;overflow-x:auto;align-items:flex-start}
.col{min-width:240px;flex:1 1 240px}.col h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);margin:0 0 8px}
.group{display:flex;gap:12px;border:2px solid var(--acc);border-radius:8px;padding:8px;flex:3 1 760px}
.group>.col{min-width:200px}.group-label{writing-mode:vertical-rl;color:var(--acc);font-weight:600;text-transform:uppercase;font-size:12px}
details.col summary{cursor:pointer;font-size:12px;text-transform:uppercase;color:var(--mut);margin-bottom:8px}
.card{display:block;width:100%;text-align:left;font:inherit;color:inherit;background:var(--card);border:1px solid var(--bd);border-radius:6px;padding:8px;margin-bottom:8px;cursor:pointer}
.card:hover,.card:focus-visible{border-color:var(--acc);outline:none}.card .t{font-weight:600}.card .m{color:var(--mut);font-size:12px;margin-top:4px}
.flag{color:var(--acc);font-weight:600}
dialog{max-width:720px;width:90vw;background:var(--card);color:var(--fg);border:1px solid var(--bd);border-radius:8px}
dialog::backdrop{background:#0006}.pre{white-space:pre-wrap}.cm{border-top:1px solid var(--bd);padding:8px 0}.rp{margin-left:16px;color:var(--mut)}
button.x{font:inherit;cursor:pointer}
`

const JS = `
const data=JSON.parse(document.getElementById("board-data").textContent);
const GROUPS=[["Waiting on you",["need_info","blocked","pending_review"]],[null,["in_progress"]],[null,["todo"]],[null,["backlog"]]];
const CLOSED=["done","canceled"];
const ALL=["backlog","todo","in_progress","need_info","blocked","pending_review","done","canceled"];
const $=(id)=>document.getElementById(id);
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const ago=(iso)=>{const s=(Date.now()-Date.parse(iso))/1000;if(!(s>=0))return iso;
 for(const [n,u] of [[86400*30,"mo"],[86400,"d"],[3600,"h"],[60,"m"]])if(s>=n)return Math.floor(s/n)+u+" ago";return "just now"};
const all=data.boards.flatMap(b=>b.tasks.map(t=>({...t,repo:b.label})));
const sel=$("repo");
for(const l of ["",...data.boards.map(b=>b.label)]){const o=el("option",null,l||"All repos");o.value=l;sel.append(o)}
const warn=$("warnings");
for(const w of data.warnings)warn.append(el("li",null,"Could not read board "+w.label+": "+w.message));
if(data.boards.length===0)warn.append(el("li",null,"No logbook boards found."));
const dlg=$("detail");
dlg.addEventListener("click",e=>{if(e.target===dlg)dlg.close()});
const open=(t)=>{
 const b=$("detail-body");b.replaceChildren();
 b.append(el("h2",null,t.title));
 b.append(el("div","m",t.repo+" · "+t.milestone+" · "+t.status+" · priority "+t.priority));
 const idr=el("p");idr.append(el("code",null,t.id)," ");
 const cp=el("button","x","Copy id");cp.onclick=()=>{try{navigator.clipboard.writeText(t.id).catch(()=>{})}catch(e){}};idr.append(cp);b.append(idr);
 b.append(el("h3",null,"Description"),el("div","pre",t.description));
 b.append(el("h3",null,"Definition of done"),el("div","pre",t.definitionOfDone));
 b.append(el("h3",null,"Comments"));
 const cs=[...t.comments].sort((a,c)=>Date.parse(c.createdAt)-Date.parse(a.createdAt));
 if(!cs.length)b.append(el("div","m","None"));
 for(const c of cs){const d=el("div","cm");d.append(el("strong",null,(c.title?c.title+" ":"")+"["+c.kind+"] "),el("span","m",ago(c.createdAt)),el("div","pre",c.content));
  for(const r of c.replies||[])d.append(el("div","rp pre",typeof r==="string"?r:(r.content??JSON.stringify(r))));
  b.append(d)}
 const close=el("button","x","Close");close.onclick=()=>dlg.close();b.append(close);
 dlg.showModal()};
const card=(t)=>{const b=el("button","card");b.type="button";b.append(el("div","t",t.title));
 const m=el("div","m",t.repo+" · "+t.milestone+" · P"+t.priority+" · "+ago(t.updatedAt));
 if(t.comments.some(c=>c.kind==="need_info"&&(c.replies||[]).length===0))m.append(" · ",el("span","flag","needs answer"));
 b.append(m);b.onclick=()=>open(t);return b};
const column=(tag,status,tasks)=>{const c=el(tag,"col");
 const h=el(tag==="details"?"summary":"h2",null,status+" ("+tasks.length+")");c.append(h);
 for(const t of tasks)c.append(card(t));return c};
const render=()=>{
 const repo=sel.value,q=$("q").value.toLowerCase();
 const ts=all.filter(t=>(!repo||t.repo===repo)&&(!q||(t.title+" "+t.description).toLowerCase().includes(q)))
  .sort((a,b)=>a.priority-b.priority||Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
 const by=(s)=>ts.filter(t=>t.status===s);
 $("counts").textContent=ALL.map(s=>s+" "+by(s).length).join(" · ");
 const m=$("cols");m.replaceChildren();
 const g=el("div","group");g.append(el("div","group-label",GROUPS[0][0]));
 for(const s of GROUPS[0][1])g.append(column("section",s,by(s)));m.append(g);
 for(const [,ss] of GROUPS.slice(1))m.append(column("section",ss[0],by(ss[0])));
 for(const s of CLOSED)m.append(column("details",s,by(s)));
};
sel.onchange=render;$("q").oninput=render;render();
`

const safeJson = (data: BoardPageData): string =>
  JSON.stringify(data)
    .replaceAll("<", "\\u003c")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029")

export const renderBoardHtml = (data: BoardPageData): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Logbook board</title><style>${CSS}</style></head><body>
<header><h1>Logbook board</h1><span id="counts"></span>
<select id="repo" aria-label="Repo"></select><input id="q" type="search" placeholder="Search" aria-label="Search"></header>
<ul id="warnings"></ul><main id="cols"></main>
<dialog id="detail"><div id="detail-body"></div></dialog>
<script type="application/json" id="board-data">${safeJson(data)}</script>
<script>${JS}</script></body></html>
`
