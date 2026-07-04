import { chromium } from '/Users/mac/Documents/coding/CTRL/node_modules/playwright-core/index.mjs';
const OUT='/tmp/ctrl-debug';
const b=await chromium.launch();
const pg=await b.newPage({viewport:{width:1280,height:860}});
// Inject a Tauri IPC mock so real components render with fake data (Layer 2 harness).
await pg.addInitScript(()=>{
  const notes=["daily/2026-07-04.md","projects/ctrl/CTRL.md","meeting-notes.md","AGENTS.md","irisy/SOUL.md","Stocks/watchlist.md"];
  let cbid=0; const cbs={};
  window.__TAURI_INTERNALS__={
    transformCallback:(cb)=>{const id=++cbid;cbs[id]=cb;return id;},
    invoke:async(cmd,args)=>{
      if(cmd==='review_pending') return [{id:'rv-1',caller:'hermes',tool:'vault_write',arg_summary:'path: meeting-notes.md · body: 214 chars · frontmatter: {title, date}'}];
      if(cmd==='gate_invoke'){
        const t=args&&args.tool;
        if(t==='vault_list') return notes;
        return [];
      }
      if(cmd&&cmd.startsWith('plugin:event')) return 0;
      if(cmd==='list_byo_drivers') return [];
      return null;
    },
  };
});
await pg.goto('http://localhost:5173/',{waitUntil:'networkidle'}).catch(()=>{});
await pg.waitForTimeout(3000);
// 1) review modal (seeded from mocked review_pending)
const modalTxt = await pg.locator('body').innerText();
console.log('review modal rendered:', /Approve this action|wants to run|high-impact/i.test(modalTxt)?'YES':'no');
await pg.screenshot({path:`${OUT}/vis_modal.png`});
// dismiss modal (Deny) if present, then test @ menu
const deny=pg.getByRole('button',{name:/Deny/i}); if(await deny.count()) await deny.first().click().catch(()=>{});
await pg.waitForTimeout(500);
const ta=pg.getByPlaceholder(/Ask Irisy/i);
if(await ta.count()){ await ta.click(); await ta.fill('@'); await pg.waitForTimeout(500);
  const items=await pg.locator('[role="listbox"] button').allInnerTexts();
  console.log('@ mention menu items:', items.length?items.map(t=>t.replace(/\s+/g,' ')).join(' | '):'(empty)');
  await pg.screenshot({path:`${OUT}/vis_mention.png`});
}
await b.close();
