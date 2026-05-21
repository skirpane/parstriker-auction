// src/App.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { initializeApp, FirebaseApp } from "firebase/app";
import { getDatabase, Database, ref, onValue, set, update, get } from "firebase/database";

// ─── FIREBASE ─────────────────────────────────────────────────────────────────
interface FBConfig { apiKey:string; authDomain:string; databaseURL:string; projectId:string; storageBucket:string; messagingSenderId:string; appId:string; }
// ── Firebase fully pre-configured — no setup prompt shown to users ──────────
const FULL_FB_CONFIG:FBConfig = {
  apiKey:             "AIzaSyD3k2c_0oX3C3f1nAqDRYidKYNCGJgF7I4",
  authDomain:         "parstriker-auction.firebaseapp.com",
  databaseURL:        "https://parstriker-auction-default-rtdb.firebaseio.com",
  projectId:          "parstriker-auction",
  storageBucket:      "parstriker-auction.firebasestorage.app",
  messagingSenderId:  "1400458016",
  appId:              "1:1400458016:web:b19f0b8d854f5a9df02545",
};
const FB_STORE_KEY = "ps_fb_config_v5";
const loadCfg=():FBConfig=>FULL_FB_CONFIG;
const saveCfg=(_c:FBConfig)=>{};
let _app:FirebaseApp|null=null,_db:Database|null=null;
const initFB=(cfg:FBConfig):Database=>{if(!_app){_app=initializeApp(cfg);_db=getDatabase(_app);}return _db!;};
const getDb=():Database=>{if(_db)return _db;const c=loadCfg();if(c)return initFB(c);throw new Error("FB not ready");};
const fbRef=()=>ref(getDb(),"psAuction_v23");
const authRef=()=>ref(getDb(),"psAuth_v1"); // separate node — stores hashed passwords only
const safeParse=(raw:any):AuctionState=>{
  // Firebase can return arrays as objects {0:x,1:y} — normalize everything
  const toArr=(v:any)=>!v?[]:Array.isArray(v)?v:Object.values(v);
  return{
    ...raw,
    queue:toArr(raw.queue),
    log:toArr(raw.log),
    skippedTeams:toArr(raw.skippedTeams),
    rotatingPool:toArr(raw.rotatingPool),
    firstBidder:raw.firstBidder??null,
    teams:toArr(raw.teams).map((t:any)=>({...t,squad:toArr(t.squad)})),
    players:toArr(raw.players),
  };
};
const readSt=async():Promise<AuctionState>=>{const s=await get(fbRef());return s.exists()?safeParse(s.val()):INIT_STATE;};
const writeSt=async(s:AuctionState)=>set(fbRef(),s);
const patchSt=async(p:Partial<AuctionState>)=>update(fbRef(),p);

// ── SHA-256 hash via browser SubtleCrypto — passwords never stored plain ──
const sha256=async(text:string):Promise<string>=>{
  const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
};

// ── Write hashed passwords to Firebase (admin calls this once on first run) ─
// Stored at /psAuth_v1 — separate from auction data, never in JS bundle
const initAuth=async()=>{
  const snap=await get(authRef());
  if(snap.exists())return; // already set — don't overwrite
  // These are the ONLY place passwords appear — hashed immediately, never stored plain
  const [ah,bh,rkh,wwh]=await Promise.all([
    sha256("Parstriker#0"),
    sha256("BlueIndians#0"),
    sha256("RedKnights#0"),
    sha256("WhiteWolves#0"),
  ]);
  await set(authRef(),{admin:ah, bi:bh, rk:rkh, ww:wwh});
};

// ── Verify a password attempt against stored hash ──────────────────────────
const verifyPass=async(attempt:string,role:"admin"|"bi"|"rk"|"ww"):Promise<boolean>=>{
  try{
    const snap=await get(authRef());
    if(!snap.exists())return false;
    const hashes=snap.val() as Record<string,string>;
    const attemptHash=await sha256(attempt);
    return hashes[role]===attemptHash;
  }catch{return false;}
};

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Role="login"|"admin"|"captain"|"viewer";
type Phase="banner"|"running"|"roundDone"|"done";
interface Player{id:number;name:string;role:string;tier:string;country:string;img:string;basePrice:number;soldTo:number|null;soldPrice:number|null;round:number|null;isCaptain?:boolean;chUrl?:string;}
interface SquadPlayer extends Player{soldPrice:number;isMarquee:boolean;round:number;isCaptain?:boolean;}
interface Team{id:number;name:string;short:string;color:string;accent:string;purse:number;squad:SquadPlayer[];marqueeCount:number;captainPlayerId:number;}
interface LogItem{icon:string;text:string;time:string;}
interface AuctionState{queue:number[];curIdx:number;curBid:number;curBidder:number|null;firstBidder:number|null;aRound:number;phase:Phase;showSold:boolean;aDone:boolean;log:LogItem[];teams:Team[];players:Player[];dataVersion:number;lastSold?:{playerName:string;teamName:string;teamColor:string;teamId:number;price:number;}|null;skippedTeams?:number[];rotatingPool?:number[];}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const PURSE=1100; const MIN_BID=10; const MAX_SQUAD=8; const MAX_MARQUEE=7;
const TOTAL_ROUNDS=3; const DATA_VERSION=23;
const safeArr=<T,>(a:T[]|null|undefined):T[]=>Array.isArray(a)?a:[];
const fmt=(v:number):string=>`${v} pts`;
const tc=(t:string):string=>({Elite:"#f59e0b","Batting All-Rounder":"#f59e0b",Premium:"#a78bfa",Keeper:"#38bdf8",Batsman:"#34d399",Bowler:"#fb923c"}[t]??"#94a3b8");

// ─── CAPTAIN PLAYER IDs ───────────────────────────────────────────────────────
// ─── CAPTAINS: BI=Ashish(id:4), RK=Kannan(id:8), WW=Sandeep(id:18) ───────────
const CAPTAIN_MAP:{[teamId:number]:number}={1:4, 2:8, 3:18};

// ═══════════════════════════════════════════════════════════════════════════════
//  PARSTRIKER AUCTION — POINT SYSTEM  (updated from final player list)
//
//  TEAM BUDGET : 500 pts each
//  BID INCREMENT: 5 pts minimum
//  SQUAD SIZE   : 8 players (1 captain pre-set + 7 auction picks)
//  MARQUEE SLOTS: 7 per team (all auction picks count as marquee)
//
//  ┌─────────────────────────────────────────────────────────────────────────┐
//  │  TIER  │  ROLE                  │  BASE PTS │  REASONING               │
//  ├─────────────────────────────────────────────────────────────────────────┤
//  │   A    │  All-Rounder (captain) │  100      │  Lead, bat+bowl elite    │
//  │   B    │  All-Rounder           │  70–90    │  Both skills, versatile  │
//  │   C    │  Batting All-Rounder   │  70–80    │  Bat primary, bowl handy │
//  │   D    │  Bowling All-Rounder   │  60–70    │  Bowl primary, bat handy │
//  │   E    │  Bowler All-Rounder    │  55–65    │  Bowling specialist + AR │
//  │   F    │  Batsman / WK          │  45–55    │  Bat or keep specialist  │
//  │   G    │  Batsman               │  35–50    │  Bat only specialist     │
//  │   H    │  Bowler / Bowling      │  30–40    │  Bowl specialist         │
//  └─────────────────────────────────────────────────────────────────────────┘
//
//  BUDGET MATH — each team picks 7 players from auction:
//  Strategy A (2 Elite AR + 5 Batsmen)    : 90+85 + 5×45 = 400 pts ✓
//  Strategy B (1 Elite + 3 AR + 3 Bat)   : 90+75+70+65 + 3×45 = 435 pts ✓
//  Strategy C (All Rounders heavy x7)     : 90+85+75+70+65+60+55 = 500 pts ✓ (exact budget!)
//  Bidding war: someone overpays 120 on Krunal → only 380 left for 6 → avg 63 → tight!
// ═══════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
//  FLAT POINTS SYSTEM — Everyone starts at 100 pts base
//
//  PURSE : 1100 pts  |  BASE : 100 pts  |  INCREMENT : 10 pts  |  PICKS : 7
//
//  BID RULE:
//  • First bid on a player  → 100 pts (base, no increase)
//  • Next team outbids      → +10 pts each time
//  • Only one team bidding  → gets player at BASE 100 pts exactly
//
//  BUDGET MATH:
//  7 players × 100 base = 700 pts used  |  400 pts buffer for bidding wars
//  Win 4 bidding wars (+100 each)       → spend exactly 1100 pts (budget exhausted!)
// ══════════════════════════════════════════════════════════════════════════════
const PLAYER_PRICES:Record<number,number>={
  // All 28 players — flat 100 pts base each
  // Captains (4, 8, 18) pre-assigned — 100 pts reference only
  1:100,2:100,3:100,4:100,5:100,6:100,7:100,8:100,9:100,10:100,
  11:100,12:100,13:100,14:100,15:100,16:100,17:100,18:100,19:100,20:100,
  21:100,22:100,23:100,24:100,25:100,26:100,27:100,28:100,
};

const RAW_PLAYERS=[
  {id:1,  name:"Pranay Raj",          role:"Batsman",              img:"PR",   chUrl:"https://cricheroes.com/player-profile/3559467/pranay/matches"},
  {id:2,  name:"Amit Jadli",          role:"Batsman / WK",         img:"AJ",   chUrl:"https://cricheroes.com/player-profile/9673952/amit-jadli/matches"},
  {id:3,  name:"Aravind",             role:"Bowling All-Rounder",  img:"AK",   chUrl:"https://cricheroes.com/player-profile/9980891/aravind/matches"},
  {id:4,  name:"Ashish Nageet",       role:"All-Rounder",          img:"AN",   chUrl:"https://cricheroes.com/player-profile/9793757/ashish-nageet/matches"},
  {id:5,  name:"Hari Reddy",          role:"Bowler",               img:"HR",   chUrl:"https://cricheroes.com/player-profile/16012495/hari-reddy-m/matches"},
  {id:6,  name:"Karan Shah",          role:"Batsman",              img:"KSh2", chUrl:"https://cricheroes.com/player-profile/49554178/karan-shah/matches"},
  {id:7,  name:"Jitendra Mistry",     role:"Batsman",              img:"JM",   chUrl:"https://cricheroes.com/player-profile/30599224/jimmy-mistry/matches"},
  {id:8,  name:"Kannan Santharam",    role:"Bowler",               img:"KS",   chUrl:"https://cricheroes.com/player-profile/22879359/kannan-shantharam/matches"},
  {id:9,  name:"Karthik Vempati",     role:"All-Rounder",          img:"KV",   chUrl:"https://cricheroes.com/player-profile/22954447/karthik-vempati/matches"},
  {id:10, name:"Nikhil Surabhi",      role:"Batsman",              img:"NS",   chUrl:"https://cricheroes.com/player-profile/9670538/nikhil-surabhi/matches"},
  {id:11, name:"Ravinder Negi",       role:"All-Rounder",          img:"RN",   chUrl:"https://cricheroes.com/player-profile/3035827/ravinder-negi(-mahi)/matches"},
  {id:12, name:"Pradeep Patil",       role:"Bowler",               img:"PP",   chUrl:"https://cricheroes.com/player-profile/31680295/pradeep-reddy-patil/matches"},
  {id:13, name:"Nikhil Shah",         role:"Batsman / WK",         img:"NSh",  chUrl:"https://cricheroes.com/player-profile/50005870/nikhil-shah/matches"},
  {id:14, name:"Vicky",               role:"Batsman / WK",         img:"VS",   chUrl:"https://cricheroes.com/player-profile/29553277/vicky-sangavkar/matches"},
  {id:15, name:"Srini Vellingiri",    role:"Batsman",              img:"SV2",  chUrl:"https://cricheroes.com/player-profile/23196220/srini/matches"},
  {id:16, name:"Rajat Mehrotra",      role:"All-Rounder",          img:"RM",   chUrl:"https://cricheroes.com/player-profile/9755522/rajat-mehrotra/matches"},
  {id:17, name:"Sameer Saxena",       role:"Batsman",              img:"SS",   chUrl:"https://cricheroes.com/player-profile/9670658/sameer-saxena/matches"},
  {id:18, name:"Sandeep Kirpane",     role:"Batting All-Rounder",  img:"SK",   chUrl:"https://cricheroes.com/player-profile/22946234/sandeep-kirpane/matches"},
  {id:19, name:"Sanjay Prajapati",    role:"Bowling All-Rounder",  img:"SP",   chUrl:"https://cricheroes.com/player-profile/29553754/sanjay-prajapati/matches"},
  {id:20, name:"Raghav Ambati",       role:"Batsman",              img:"RA",   chUrl:"https://cricheroes.com/player-profile/50005907/raghav-ambati/matches"},
  {id:21, name:"Santosh Vaghmare",    role:"Bowling All-Rounder",  img:"SV",   chUrl:"https://cricheroes.com/player-profile/15997501/santosh-waghmare/matches"},
  {id:22, name:"Savan Paka",          role:"Batsman",              img:"SPa",  chUrl:"https://cricheroes.com/player-profile/7984823/savan/matches"},
  {id:23, name:"Kayur",               role:"Bowling All-Rounder",  img:"KAy",  chUrl:"https://cricheroes.com/player-profile/42050777/kayur-cric/matches"},
  {id:24, name:"Tushar More",         role:"Bowler",               img:"TM",   chUrl:"https://cricheroes.com/player-profile/23108798/tushar-more/matches"},
  {id:25, name:"Saravanan Marimuthu", role:"Batsman",              img:"SM",   chUrl:"https://cricheroes.com/player-profile/50323634/saravanan-marimuthu/matches"},
  {id:26, name:"Janesh Chohan",       role:"All-Rounder",          img:"JC",   chUrl:"https://cricheroes.com/player-profile/9675501/janesh-chohan/matches"},
  {id:27, name:"Abdul Mubeen",        role:"Bowling All-Rounder",  img:"AM",   chUrl:"https://cricheroes.com/player-profile/39761525/abdul-mubeen-mohammed/stats"},
  {id:28, name:"Krunal Shah",         role:"All-Rounder",          img:"KSh",  chUrl:"https://cricheroes.com/player-profile/23101496/krunal-shah/matches"},
];

const roleTier=(r:string):string=>{
  if(r==="All-Rounder")               return "Elite";
  if(r==="Batting All-Rounder")       return "Elite";
  if(r.includes("Bowling All-Round")) return "Premium";
  if(r.includes("Bowler All-Round"))  return "Premium";
  if(r.includes("WK"))                return "Keeper";
  if(r==="Batsman")                   return "Batsman";
  return "Bowler";
};

// Pre-assign captains to their teams (not in auction pool)
const buildInitPlayers=():Player[]=>{
  return RAW_PLAYERS.map(p=>({
    ...p,tier:roleTier(p.role),country:"IND",
    basePrice:PLAYER_PRICES[p.id]??40,
    soldTo:null,soldPrice:null,round:null,isCaptain:false,chUrl:p.chUrl??"",
  }));
};

const buildInitTeams=():Team[]=>{
  const captainPrices:{[id:number]:number}={4:100,8:100,18:100}; // pre-assigned at 100 pts
  const teamsBase=[
    {id:1,name:"Blue Indians",short:"BI",color:"#1a56db",accent:"#FFD700",captainPlayerId:4},
    {id:2,name:"Red Knights",short:"RK",color:"#c41e3a",accent:"#FFD700",captainPlayerId:8},
    {id:3,name:"White Wolves",short:"WW",color:"#b0b8c8",accent:"#FFD700",captainPlayerId:18},
  ];
  return teamsBase.map(t=>{
    const capPlayer=RAW_PLAYERS.find(p=>p.id===t.captainPlayerId)!;
    const capSP:SquadPlayer={
      id:capPlayer.id,name:capPlayer.name,role:capPlayer.role,img:capPlayer.img,
      tier:roleTier(capPlayer.role),country:"IND",
      basePrice:captainPrices[capPlayer.id],
      soldTo:t.id,soldPrice:0,round:0,
      isMarquee:true,isCaptain:true,
    };
    return{...t,purse:PURSE,squad:[capSP],marqueeCount:0}; // captain not counted — 7 full auction slots open
  });
};

const INIT_PLAYERS=buildInitPlayers();
const INIT_TEAMS=buildInitTeams();
const INIT_STATE:AuctionState={
  queue:[],curIdx:0,curBid:0,curBidder:null,
  aRound:0,phase:"banner",showSold:false,aDone:false,
  log:[],teams:INIT_TEAMS,players:INIT_PLAYERS,dataVersion:DATA_VERSION,lastSold:null,skippedTeams:[],rotatingPool:[],firstBidder:null,
};

// ─── LOGOS (clean icon-based) ─────────────────────────────────────────────────

// Main Parstriker logo — cricket bat + ball wordmark style
 <div style={{width:size,height:size,borderRadius:"50%",background:"linear-gradient(135deg,#7c3aed,#4f46e5)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:size*0.35,color:"#fff",fontWeight:900,letterSpacing:1,flexShrink:0}}>PS</div>

// Blue Indians — bold "BI" on blue shield
const LogoBI=({size=48}:{size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="biGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#1a56db"/>
        <stop offset="100%" stopColor="#0a2a80"/>
      </linearGradient>
    </defs>
    {/* Shield shape */}
    <path d="M50 6 L88 22 L88 54 Q88 78 50 94 Q12 78 12 54 L12 22 Z" fill="url(#biGrad)" stroke="#FFD700" strokeWidth="2.5"/>
    {/* Gold band */}
    <path d="M12 36 L88 36" stroke="#FFD700" strokeWidth="2" opacity="0.6"/>
    {/* Bold BI text */}
    <text x="50" y="72" textAnchor="middle" fill="#FFD700" fontSize="30" fontFamily="'Bebas Neue',Arial" fontWeight="900" letterSpacing="2">BI</text>
    {/* Top accent */}
    <text x="50" y="31" textAnchor="middle" fill="#ffffff" fontSize="9" fontFamily="Arial" opacity="0.7" letterSpacing="1">BLUE INDIANS</text>
  </svg>
);

// Red Knights — bold "RK" on red shield
const LogoRK=({size=48}:{size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="rkGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#c41e3a"/>
        <stop offset="100%" stopColor="#7a0010"/>
      </linearGradient>
    </defs>
    {/* Shield shape */}
    <path d="M50 6 L88 22 L88 54 Q88 78 50 94 Q12 78 12 54 L12 22 Z" fill="url(#rkGrad)" stroke="#FFD700" strokeWidth="2.5"/>
    {/* Gold band */}
    <path d="M12 36 L88 36" stroke="#FFD700" strokeWidth="2" opacity="0.6"/>
    {/* Bold RK text */}
    <text x="50" y="72" textAnchor="middle" fill="#FFD700" fontSize="30" fontFamily="'Bebas Neue',Arial" fontWeight="900" letterSpacing="2">RK</text>
    {/* Top accent */}
    <text x="50" y="31" textAnchor="middle" fill="#ffffff" fontSize="9" fontFamily="Arial" opacity="0.7" letterSpacing="1">RED KNIGHTS</text>
  </svg>
);

// White Wolves — bold "WW" on dark shield
const LogoWW=({size=48}:{size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="wwGrad" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#4a5568"/>
        <stop offset="100%" stopColor="#1a202c"/>
      </linearGradient>
    </defs>
    {/* Shield shape */}
    <path d="M50 6 L88 22 L88 54 Q88 78 50 94 Q12 78 12 54 L12 22 Z" fill="url(#wwGrad)" stroke="#b0b8c8" strokeWidth="2.5"/>
    {/* Silver band */}
    <path d="M12 36 L88 36" stroke="#b0b8c8" strokeWidth="2" opacity="0.6"/>
    {/* Bold WW text */}
    <text x="50" y="72" textAnchor="middle" fill="#e0e8f0" fontSize="28" fontFamily="'Bebas Neue',Arial" fontWeight="900" letterSpacing="1">WW</text>
    {/* Top accent */}
    <text x="50" y="31" textAnchor="middle" fill="#ffffff" fontSize="9" fontFamily="Arial" opacity="0.7" letterSpacing="1">WHITE WOLVES</text>
  </svg>
);

const LOGOS:Record<number,(p:{size?:number})=>JSX.Element>={1:LogoBI,2:LogoRK,3:LogoWW};
const TeamLogo=({teamId,size=40}:{teamId:number;size?:number})=>{const L=LOGOS[teamId];return L?<L size={size}/>:<div style={{width:size,height:size,borderRadius:"50%",background:"#333",display:"flex",alignItems:"center",justifyContent:"center",fontSize:size/3,color:"#fff"}}>?</div>;};

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@500;700&family=DM+Sans:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#13111e;       /* Deep purple-black like Pixelait */
  --s1:#1e1a2e;       /* Purple-dark card */
  --s2:#221e32;       /* Slightly lighter purple */
  --s3:#2a2440;       /* Card hover */
  --bd:#3d3560;       /* Purple border */
  --gold:#a78bfa;     /* Soft violet-purple accent (main) */
  --cyan:#818cf8;     /* Indigo accent */
  --green:#34d399;
  --txt:#f1f0ff;      /* Near-white with slight purple tint */
  --mut:#8b82b0;      /* Muted purple-grey */
  --ok:#34d399;
  --ng:#f87171;
  --warn:#fb923c;
  --purple:#7c3aed;   /* Rich purple for highlights */
  --indigo:#4f46e5;   /* Deep indigo */
  --violet:#8b5cf6;   /* Medium violet */
}
body{background:var(--bg);color:var(--txt);font-family:'DM Sans',sans-serif;min-height:100vh;overflow-x:hidden;overflow-y:auto;-webkit-font-smoothing:antialiased;}

/* SETUP */
.sw{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;
  background:linear-gradient(135deg,#1a1528 0%,#13111e 50%,#16122a 100%);}
.sb2{background:linear-gradient(145deg,#221e32,#1a1528);border:1px solid rgba(139,92,246,.3);border-radius:20px;padding:32px 28px;width:100%;max-width:460px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
.slogo{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:6px}
.slt{font-family:'Bebas Neue';font-size:32px;letter-spacing:4px;background:linear-gradient(90deg,#FFD700,#00e5ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.ssub{font-family:'Bebas Neue';font-size:13px;letter-spacing:4px;color:var(--mut);text-align:center;margin-bottom:20px}
.sdesc{font-size:11px;color:var(--mut);line-height:1.7;margin-bottom:18px;background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.12);border-radius:10px;padding:12px 14px}
.sdesc b{color:var(--cyan)}
.spre{background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.12);border-radius:12px;padding:14px 16px;margin-bottom:18px}
.spret{font-size:9px;color:var(--cyan);text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:10px}
.sprer{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}
.sprel{font-size:10px;color:var(--mut)}
.sprev{font-size:10px;color:var(--txt);font-family:monospace;background:rgba(255,255,255,.06);padding:2px 7px;border-radius:4px}
.sfield{margin-bottom:10px}
.slbl{font-size:9px;color:var(--cyan);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:3px;display:block}
.sinp{width:100%;background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.2);border-radius:8px;padding:11px 12px;color:var(--txt);font-size:15px;outline:none;transition:all .2s;text-align:center;letter-spacing:2px}
.sinp:focus{border-color:var(--cyan);box-shadow:0 0 10px rgba(0,229,255,.15)}
.serr{background:rgba(255,51,85,.12);border:1px solid rgba(255,51,85,.4);border-radius:8px;padding:8px 12px;font-size:11px;color:var(--ng);margin-bottom:10px}
.sbtn{width:100%;margin-top:14px;padding:14px;background:linear-gradient(135deg,#7c3aed,#4f46e5);border:none;border-radius:11px;color:#000;font-family:'Bebas Neue';font-size:19px;letter-spacing:3px;cursor:pointer;transition:all .25s;font-weight:900}
.sbtn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(255,215,0,.3)}

/* CONNECTING */
.conn{min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;background:var(--bg)}
.spin{width:44px;height:44px;border:3px solid rgba(0,229,255,.15);border-top-color:var(--cyan);border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* HEADER */
.hdr{background:linear-gradient(90deg,#0e0c1a,#1a1528,#0e0c1a);border-bottom:1px solid rgba(124,58,237,.3);padding:10px 18px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:200;backdrop-filter:blur(20px);box-shadow:0 2px 20px rgba(0,0,0,.3)}
.hlw{display:flex;align-items:center;gap:10px}
.hl{font-family:'Bebas Neue';font-size:20px;letter-spacing:3px;background:linear-gradient(90deg,var(--gold),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.1}
.hl-sub{font-size:9px;color:var(--mut);letter-spacing:2px;font-family:'Rajdhani'}
.hr{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
.rp{padding:3px 11px;border-radius:20px;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border:1px solid}
.xb{background:transparent;border:1px solid var(--bd);color:var(--mut);padding:5px 12px;border-radius:7px;cursor:pointer;font-size:11px;transition:all .2s}
.xb:hover{border-color:var(--ng);color:var(--ng)}
.nb{background:transparent;border:1px solid var(--ng);color:var(--ng);padding:5px 12px;border-radius:7px;cursor:pointer;font-size:11px}

/* NAV */
.nav{background:rgba(19,17,30,.9);border-bottom:1px solid var(--bd);padding:0 18px;display:flex;gap:2px;overflow-x:auto;overflow-y:hidden;backdrop-filter:blur(10px);scrollbar-width:none;-ms-overflow-style:none}.nav::-webkit-scrollbar{display:none}
.nt{background:transparent;border:none;color:var(--mut);padding:12px 14px;cursor:pointer;font-family:'Rajdhani';font-weight:700;font-size:12px;letter-spacing:1px;border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap}
.nt:hover{color:var(--txt)} .nt.on{color:var(--gold);border-bottom-color:var(--gold)}

/* LOGIN */
.lw{min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:16px;overflow-y:auto;
  background:linear-gradient(160deg,#0e0c1a 0%,#13111e 40%,#1a1528 70%,#0e0c1a 100%)}
.lhero{display:flex;flex-direction:column;align-items:center;margin-bottom:20px;gap:0}
.lhero-headline{display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap;justify-content:center}
.lhero-parsippany{font-family:'Bebas Neue';font-size:48px;letter-spacing:6px;line-height:1;
  background:linear-gradient(90deg,#a78bfa,#818cf8,#38bdf8);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.lhero-sep{font-family:'Bebas Neue';font-size:48px;letter-spacing:0;line-height:1;
  color:rgba(167,139,250,.3);margin:0 -4px}
.lhero-title{font-family:'Bebas Neue';font-size:48px;letter-spacing:6px;line-height:1;
  background:linear-gradient(90deg,#818cf8,#38bdf8,#a78bfa);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.lhero-tag{font-size:10px;color:var(--mut);letter-spacing:3px;margin-bottom:20px}
.lhero-teams{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:24px;
  padding:14px 28px;background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.2);
  border-radius:16px;flex-wrap:wrap}
.lhero-team{display:flex;flex-direction:column;align-items:center;gap:4px}
.lhero-team-name{font-family:'Bebas Neue';font-size:10px;letter-spacing:2px;text-align:center}
.lb{background:linear-gradient(145deg,#221e32,#1a1528);border:1px solid rgba(124,58,237,.25);border-radius:22px;padding:24px 28px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,.6)}
.ls{color:var(--mut);font-size:12px;margin-bottom:16px;text-align:center}
.rg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}
.rb{background:rgba(139,92,246,.06);border:1px solid var(--bd);border-radius:12px;padding:14px 8px;cursor:pointer;transition:all .2s;color:var(--txt);text-align:center}
.rb:hover{border-color:rgba(139,92,246,.5);background:rgba(139,92,246,.1)}
.rb.sel{border-color:var(--violet);background:rgba(139,92,246,.15);box-shadow:0 0 14px rgba(139,92,246,.25)}
.ri{font-size:22px;margin-bottom:5px} .rn{font-family:'Rajdhani';font-weight:700;font-size:13px;letter-spacing:1px;color:var(--gold)} .rh{font-size:9px;color:var(--mut);margin-top:2px}
.inp{width:100%;background:rgba(139,92,246,.06);border:1px solid rgba(139,92,246,.3);border-radius:9px;padding:11px 14px;color:var(--txt);font-size:13px;outline:none;transition:all .2s;margin-bottom:10px}
.inp:focus{border-color:var(--violet);box-shadow:0 0 12px rgba(139,92,246,.25)}
.gb{width:100%;padding:14px;background:linear-gradient(135deg,#7c3aed,#4f46e5);border:none;border-radius:11px;color:#000;font-family:'Bebas Neue';font-size:19px;letter-spacing:3px;cursor:pointer;transition:all .2s;font-weight:900}
.gb:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(124,58,237,.4)} .gb:disabled{opacity:.35;cursor:not-allowed;transform:none}
.em{color:var(--ng);font-size:11px;margin-bottom:8px;background:rgba(255,51,85,.1);border:1px solid rgba(255,51,85,.3);border-radius:7px;padding:7px 10px}
.ht{margin-top:12px;font-size:10px;color:var(--mut);line-height:1.8;text-align:center}

/* ROUND BANNER */
.rbn{text-align:center;padding:36px 24px;max-width:580px;margin:0 auto;width:100%;box-sizing:border-box}
.rbe{font-family:'Rajdhani';font-size:11px;letter-spacing:4px;color:var(--mut);text-transform:uppercase;margin-bottom:8px}
.rbt{font-family:'Bebas Neue';font-size:52px;letter-spacing:5px;margin-bottom:10px;background:linear-gradient(90deg,var(--gold),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.rbd{color:var(--mut);font-size:13px;margin-bottom:24px;line-height:1.7}
.rbb{padding:14px 40px;background:linear-gradient(135deg,#7c3aed,#4f46e5);border:none;border-radius:12px;color:#000;font-family:'Bebas Neue';font-size:21px;letter-spacing:3px;cursor:pointer;transition:all .25s;font-weight:900}
.rbb:hover{transform:translateY(-3px);box-shadow:0 10px 30px rgba(124,58,237,.5)}

/* AUCTION LAYOUT */
.al{display:grid;grid-template-columns:1fr 300px;min-height:0}
.stg{padding:18px;overflow-y:auto;overflow-x:hidden;background:linear-gradient(180deg,#17132a 0%,#13111e 100%)}
.st{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px}
.rpill{padding:4px 12px;border-radius:20px;font-family:'Rajdhani';font-weight:700;font-size:11px;letter-spacing:1px;background:rgba(255,215,0,.1);color:var(--gold);border:1px solid rgba(255,215,0,.3)}
.pb{background:rgba(255,255,255,.08);border-radius:4px;height:4px;width:140px;margin-top:4px}
.pf{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--gold),var(--cyan));transition:width .5s}
.spl{background:linear-gradient(145deg,rgba(34,30,50,.95),rgba(26,22,42,.95));border:1px solid rgba(124,58,237,.25);border-radius:20px;padding:24px;text-align:center;margin-bottom:14px;position:relative;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.3);width:100%;box-sizing:border-box}
.spl::before{content:'';position:absolute;top:-40%;left:-20%;width:140%;height:140%;background:radial-gradient(ellipse,rgba(255,215,0,.04),transparent 55%);pointer-events:none}
.tt{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.05);border-radius:20px;padding:4px 12px;margin-bottom:12px;font-size:10px;font-weight:700;letter-spacing:1.5px;border:1px solid}
.pav{width:76px;height:76px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue';font-size:18px;margin:0 auto 10px;border:3px solid}
.pn{font-family:'Bebas Neue';font-size:32px;letter-spacing:3px;line-height:1;margin-bottom:8px}
.pm{display:flex;justify-content:center;gap:6px;margin-bottom:12px;flex-wrap:wrap;width:100%}
.ch{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:3px 10px;font-size:11px;color:var(--txt)}
.bb{background:rgba(14,12,26,.8);border:1px solid rgba(139,92,246,.2);border-radius:12px;padding:14px;margin-bottom:14px}
.bl{font-size:9px;color:var(--mut);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:2px}
.ba{font-family:'Bebas Neue';font-size:44px;letter-spacing:2px;line-height:1;background:linear-gradient(90deg,var(--gold),#ff9900);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.bs{font-size:11px;color:var(--mut);margin-top:2px}
.bldr{font-family:'Rajdhani';font-size:13px;font-weight:700;margin-top:5px}
.bg{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:9px;width:100%}
.tbb{padding:10px 7px;border-radius:10px;border:2px solid;cursor:pointer;font-family:'Rajdhani';font-weight:700;font-size:11px;transition:all .2s;text-align:left}
.tbb:disabled{opacity:.25;cursor:not-allowed} .tbb:not(:disabled):hover{transform:translateY(-2px)}
.tdg{font-family:'Bebas Neue';font-size:11px;letter-spacing:1.5px;padding:2px 5px;border-radius:3px}
.ar{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.sdb{background:linear-gradient(135deg,#34d399,#059669);border:none;border-radius:10px;color:#000;padding:12px;font-family:'Bebas Neue';font-size:18px;letter-spacing:2px;cursor:pointer;transition:all .2s;font-weight:900}
.sdb:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,255,136,.3)} .sdb:disabled{opacity:.35;cursor:not-allowed}
.usb{background:transparent;border:2px solid var(--bd);border-radius:10px;color:var(--mut);padding:12px;font-family:'Bebas Neue';font-size:18px;letter-spacing:2px;cursor:pointer;transition:all .2s}
.usb:hover:not(:disabled){border-color:var(--ng);color:var(--ng)} .usb:disabled{opacity:.35;cursor:not-allowed}

/* SOLD OVERLAY */
.so{position:absolute;inset:0;background:rgba(12,10,22,.95);display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:20px;z-index:10;animation:fi .3s ease;backdrop-filter:blur(4px)}
.sot{font-family:'Bebas Neue';font-size:62px;letter-spacing:8px;color:var(--ok);animation:zi .4s ease;text-shadow:0 0 30px rgba(0,255,136,.5)}
.soto{font-size:14px;color:var(--mut);margin-top:3px}
.sop{font-family:'Bebas Neue';font-size:28px;background:linear-gradient(90deg,var(--gold),#ff9900);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes zi{from{transform:scale(.3) rotate(-5deg);opacity:0}to{transform:scale(1) rotate(0);opacity:1}}

/* SIDEBAR */
.sb{background:rgba(17,14,28,.9);border-left:1px solid var(--bd);overflow-y:auto;max-height:calc(100vh - 65px);backdrop-filter:blur(10px)}
.ss{padding:12px;border-bottom:1px solid rgba(56,189,248,.1)}
.sbt{font-family:'Rajdhani';font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--mut);margin-bottom:10px}
.tc{background:rgba(34,30,50,.6);border-radius:9px;padding:10px;margin-bottom:6px;border:1px solid rgba(124,58,237,.15);transition:all .2s}
.tc.lead{border-color:var(--violet);box-shadow:0 0 12px rgba(139,92,246,.25)}
.tr{display:flex;justify-content:space-between;align-items:center}
.pbo{background:rgba(56,189,248,.1);border-radius:3px;height:3px;margin-top:5px}
.pbi{height:100%;border-radius:3px;transition:width .5s}
.sc{font-size:9px;color:var(--mut);margin-top:4px}
.ls{max-height:180px;overflow-y:auto}
.lr{display:flex;gap:7px;padding:5px 0;border-bottom:1px solid rgba(56,189,248,.06)}
.li{font-size:11px;flex-shrink:0;margin-top:1px} .lt{font-size:10px;line-height:1.4;flex:1} .ltime{font-size:8px;color:var(--mut)}

/* ─── CAPTAIN DASHBOARD ─── */
.cap-layout{display:grid;grid-template-columns:1fr 280px;min-height:0;overflow:visible}
.cap-main{padding:16px;overflow-y:auto;overflow-x:hidden;background:linear-gradient(180deg,#17132a 0%,#13111e 100%)}
.cap-side{background:rgba(17,14,28,.9);border-left:1px solid var(--bd);overflow-y:auto;max-height:calc(100vh - 65px);backdrop-filter:blur(10px)}

/* Captain purse strip */
.cap-pts-strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:16px;width:100%}
.cap-stat{background:linear-gradient(145deg,#221e32,#1a1528);border:1px solid rgba(124,58,237,.2);border-radius:11px;padding:12px;text-align:center;transition:all .3s;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.cap-stat.glow-gold{border-color:rgba(167,139,250,.6);box-shadow:0 0 16px rgba(139,92,246,.2)}
.cap-stat.glow-red{border-color:rgba(255,51,85,.5);box-shadow:0 0 16px rgba(255,51,85,.2)}
.csv{font-family:'Bebas Neue';font-size:24px;letter-spacing:1px}
.csl{font-size:8px;color:var(--mut);text-transform:uppercase;letter-spacing:1px;margin-top:2px}

/* Bidding stage for captain */
.bid-stage{background:linear-gradient(145deg,#221e32,#1a1528);border:2px solid rgba(124,58,237,.2);border-radius:18px;padding:20px;text-align:center;transition:all .3s;margin-bottom:16px;box-shadow:0 4px 20px rgba(0,0,0,.3)}
.bid-stage.hot{border-color:rgba(139,92,246,.7);box-shadow:0 0 30px rgba(124,58,237,.2),inset 0 0 30px rgba(124,58,237,.04);animation:stagePulse 2s infinite}
@keyframes stagePulse{0%,100%{box-shadow:0 0 30px rgba(124,58,237,.2)}50%{box-shadow:0 0 50px rgba(124,58,237,.35)}}
.bid-stage.leading{border-color:rgba(52,211,153,.6);box-shadow:0 0 30px rgba(52,211,153,.2)}
.nm{color:var(--mut);font-size:13px;padding:44px 0}

/* Big bid display */
.cur-bid-display{background:rgba(0,0,0,.5);border-radius:14px;padding:16px;margin:12px 0}
.cbd-label{font-size:9px;color:var(--mut);text-transform:uppercase;letter-spacing:2px;margin-bottom:4px}
.cbd-amount{font-family:'Bebas Neue';font-size:52px;line-height:1;background:linear-gradient(90deg,var(--gold),#ff9900);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.cbd-amount.leading-amount{background:linear-gradient(90deg,var(--ok),#00cc66);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.cbd-leader{font-family:'Rajdhani';font-size:14px;font-weight:700;margin-top:6px;padding:5px 14px;border-radius:20px;display:inline-block}

.cbb{width:100%;margin-top:14px;padding:18px;border:none;border-radius:13px;color:#fff;font-family:'Bebas Neue';font-size:24px;letter-spacing:4px;cursor:pointer;transition:all .25s;font-weight:900;position:relative;overflow:hidden}
.cbb:hover:not(:disabled){transform:translateY(-3px)}
.cbb:disabled{opacity:.32;cursor:not-allowed}
/* cbb::after removed */

/* Captain side panel */
.cap-side-sec{padding:12px;border-bottom:1px solid rgba(56,189,248,.1)}
.cap-side-title{font-family:'Rajdhani';font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--mut);margin-bottom:10px}
.cap-squad-item{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(56,189,248,.08)}
.cap-squad-item:last-child{border-bottom:none}
.cap-sq-av{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue';font-size:8px;border:1.5px solid;flex-shrink:0}
.cap-sq-info{flex:1}
.cap-sq-name{font-size:11px;font-weight:700;line-height:1.2;color:#ffffff}
.cap-sq-role{font-size:9px;color:var(--mut)}
.cap-sq-price{font-family:'Rajdhani';font-weight:700;font-size:11px;color:var(--gold)}

/* PLAYER POOL */
.pgw{padding:14px;max-width:1000px;margin:0 auto;width:100%;box-sizing:border-box}
.fr{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}
.fb{background:rgba(255,255,255,.04);border:1px solid var(--bd);color:var(--mut);padding:4px 11px;border-radius:14px;cursor:pointer;font-size:11px;transition:all .2s}
.fb.on,.fb:hover{border-color:var(--gold);color:var(--gold);background:rgba(255,215,0,.06)}
.pgg{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;width:100%}
.pc{background:linear-gradient(145deg,#221e32,#1a1528);border:1px solid rgba(124,58,237,.15);border-radius:11px;padding:12px;transition:all .2s;box-shadow:0 2px 8px rgba(0,0,0,.2)}
.pc:hover{border-color:rgba(139,92,246,.4);transform:translateY(-2px);box-shadow:0 6px 18px rgba(124,58,237,.15)} .pc.sp{opacity:.5}
.pcav{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue';font-size:10px;border:2px solid;margin-bottom:7px}
.pcn{font-family:'Rajdhani';font-weight:700;font-size:13px;margin-bottom:2px;line-height:1.2;color:#ffffff;letter-spacing:.3px}
.pcr{font-size:9px;color:var(--mut);margin-bottom:5px;line-height:1.3}
.pctb{font-size:8px;padding:2px 6px;border-radius:7px;background:rgba(255,255,255,.06);display:inline-block}
.pcs{font-size:9px;color:var(--ok);font-weight:700;margin-top:4px} .pcb{font-size:9px;color:var(--mut);margin-top:3px}
.ch-link{display:flex;align-items:center;justify-content:center;gap:5px;margin-top:8px;padding:7px 0;background:rgba(124,58,237,.1);border:1px solid rgba(139,92,246,.3);border-radius:8px;color:#a78bfa;font-size:10px;font-weight:700;cursor:pointer;text-decoration:none;transition:all .2s;letter-spacing:.5px;min-height:32px}
.ch-link:hover{background:rgba(124,58,237,.22);border-color:#a78bfa;transform:translateY(-1px);color:#c4b5fd}

/* TEAM CARDS */
.tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:14px;padding:16px;max-width:960px;margin:0 auto;width:100%}
.tfc{border-radius:14px;overflow:hidden;border:1px solid rgba(124,58,237,.15);background:linear-gradient(145deg,#221e32,#1a1528);transition:all .3s;box-shadow:0 4px 20px rgba(0,0,0,.25)}
.tfc:hover{transform:translateY(-3px)}
.tfh{padding:14px 16px;display:flex;align-items:center;gap:12px;position:relative;overflow:hidden}
.tfn{font-family:'Bebas Neue';font-size:17px;letter-spacing:2px;flex:1}
.tfs{display:flex;gap:6px;padding:0 14px 12px}
.tv{background:rgba(20,17,35,.7);border:1px solid rgba(124,58,237,.15);border-radius:7px;padding:7px 9px;flex:1;text-align:center}
.tvv{font-family:'Rajdhani';font-weight:700;font-size:15px} .tvl{font-size:8px;color:var(--mut);text-transform:uppercase;letter-spacing:1px}
.tfl{padding:0 14px 14px}
.tpr{display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px solid rgba(56,189,248,.07)}
.tpr:last-child{border-bottom:none}
.tpa{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;border:1.5px solid;flex-shrink:0}
.tpi{flex:1} .tpn{font-size:11px;font-weight:700;color:#ffffff} .tps{font-size:9px;color:var(--mut)}
.tpp{font-family:'Rajdhani';font-weight:700;font-size:10px;color:var(--gold)}
.mq{font-size:7px;background:var(--gold);color:#000;padding:1px 3px;border-radius:2px;font-weight:700;margin-left:3px}
.cap-tag{font-size:7px;background:var(--cyan);color:#000;padding:1px 4px;border-radius:2px;font-weight:700;margin-left:3px;letter-spacing:.5px}

/* VIEWER */
.vtk{padding:8px 16px;display:flex;align-items:center;gap:9px;overflow:hidden;background:rgba(17,14,28,.9);border-bottom:1px solid rgba(124,58,237,.25)}
.vld{background:var(--ng);color:#fff;font-size:8px;font-weight:700;padding:2px 5px;border-radius:3px;letter-spacing:1px;animation:pulse 1.5s infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.vtxt{font-size:11px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ─── POPUP OVERLAYS ─── */
.overlay-backdrop{position:fixed;inset:0;background:rgba(8,6,18,.92);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;animation:fi .3s ease;backdrop-filter:blur(12px)}

/* Viewer sold popup */
.viewer-sold-popup{background:linear-gradient(145deg,#221e32,#13111e);border:2px solid;border-radius:22px;padding:24px 20px;text-align:center;max-width:360px;width:calc(100% - 32px);position:relative;animation:popIn .4s cubic-bezier(.175,.885,.32,1.275);box-shadow:0 24px 60px rgba(0,0,0,.5);max-height:90vh;overflow-y:auto}
@keyframes popIn{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}
.vsp-player{font-family:'Bebas Neue';font-size:36px;letter-spacing:3px;margin:12px 0 6px;line-height:1}
.vsp-role{font-size:12px;color:var(--mut);margin-bottom:16px}
.vsp-selected{font-family:'Bebas Neue';font-size:16px;letter-spacing:3px;color:var(--mut);margin-bottom:8px}
.vsp-team{font-family:'Bebas Neue';font-size:28px;letter-spacing:3px;margin-bottom:6px}
.vsp-close{margin-top:20px;padding:10px 28px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:10px;color:var(--txt);font-family:'Bebas Neue';font-size:16px;letter-spacing:2px;cursor:pointer}

/* Captain celebration popup */
.cap-celeb-popup{background:linear-gradient(145deg,#0d2818,#17132a);border:2px solid var(--ok);border-radius:24px;padding:28px 22px;text-align:center;max-width:420px;width:calc(100% - 32px);position:relative;animation:popIn .4s cubic-bezier(.175,.885,.32,1.275);box-shadow:0 24px 60px rgba(0,0,0,.5),0 0 50px rgba(52,211,153,.25);overflow:hidden;max-height:90vh;overflow-y:auto}
.celeb-rain{position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;overflow:hidden}
.celeb-emoji{position:absolute;font-size:22px;animation:emojiRain linear infinite;opacity:0}
@keyframes emojiRain{0%{transform:translateY(-30px) rotate(0deg);opacity:1}100%{transform:translateY(500px) rotate(360deg);opacity:0}}
.confetti{font-size:28px;animation:confettiFall 1s ease-out infinite alternate}
@keyframes confettiFall{from{transform:translateY(0) rotate(0deg)}to{transform:translateY(-8px) rotate(20deg)}}
.celeb-title{font-family:'Bebas Neue';font-size:42px;letter-spacing:4px;color:var(--ok);margin:10px 0 4px;text-shadow:0 0 30px rgba(52,211,153,.6)}
.celeb-player{font-family:'Bebas Neue';font-size:30px;letter-spacing:2px;margin:8px 0;line-height:1}
.celeb-price{font-family:'Bebas Neue';font-size:22px;letter-spacing:2px;color:var(--gold);margin:4px 0}
.celeb-purse{font-size:12px;color:var(--mut);margin-top:8px}
.celeb-close{margin-top:20px;padding:11px 32px;background:linear-gradient(135deg,var(--ok),#00cc66);border:none;border-radius:11px;color:#000;font-family:'Bebas Neue';font-size:18px;letter-spacing:2px;cursor:pointer;font-weight:900}

/* DONE */
.done{text-align:center;padding:40px 20px}
.dtr{font-size:66px;animation:bou 1s infinite alternate}
@keyframes bou{from{transform:translateY(0)}to{transform:translateY(-10px)}}
.dtl{font-family:'Bebas Neue';font-size:44px;letter-spacing:5px;margin:12px 0 6px;background:linear-gradient(90deg,var(--gold),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}

/* FOOTER */
.ps-footer{text-align:center;padding:18px 16px;border-top:1px solid rgba(124,58,237,.15);background:linear-gradient(0deg,rgba(20,17,35,.5),transparent);margin-top:8px}
.ps-footer-txt{font-family:'Rajdhani';font-size:11px;letter-spacing:2px;color:rgba(255,215,0,.35);text-transform:uppercase}
.ps-footer-txt span{background:linear-gradient(90deg,var(--gold),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:700;letter-spacing:3px}

.sync-toast{position:fixed;bottom:12px;right:12px;background:rgba(34,30,50,.95);border:1px solid rgba(124,58,237,.4);border-radius:8px;padding:6px 12px;font-size:11px;color:var(--cyan);z-index:999;backdrop-filter:blur(10px)}

::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0f0d1a} ::-webkit-scrollbar-thumb{background:#3d3560;border-radius:3px}

/* ─── RESPONSIVE ─────────────────────────────────────────────── */
/* Tablet */
/* ─── FLUID BASE — all layouts use flexible units ─── */
html{font-size:16px}

/* ─── TABLET 900px ─── */
@media(max-width:900px){
  .tgrid{grid-template-columns:repeat(2,1fr);gap:12px;padding:12px}
  .pgg{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
  .sqg{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
  .al{grid-template-columns:1fr 260px}
  .cap-layout{grid-template-columns:1fr 240px}
  .rbn{padding:24px 16px}
  .rbt{font-size:40px}
}

/* ─── SMALL TABLET / LARGE PHONE 768px ─── */
@media(max-width:768px){
  /* Layouts stack vertically */
  .al{grid-template-columns:1fr;min-height:unset;overflow:visible}
  .sb{max-height:none;border-left:none;border-top:1px solid var(--bd);overflow:visible}
  .ls{max-height:160px}
  .cap-layout{grid-template-columns:1fr;min-height:unset;overflow:visible}
  .cap-side{max-height:none;border-left:none;border-top:1px solid var(--bd);overflow:visible}
  /* Grids */
  .bg{grid-template-columns:repeat(3,1fr);gap:5px}
  .tgrid{grid-template-columns:1fr;gap:10px;padding:10px}
  .pgg{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
  .sqg{grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
  .cap-pts-strip{grid-template-columns:repeat(2,2fr) repeat(2,1fr)}
  /* Type scaling */
  .pn{font-size:24px;letter-spacing:2px}
  .ba{font-size:32px}
  .cbd-amount{font-size:40px!important}
  .rbt{font-size:36px;letter-spacing:3px}
  /* Components */
  .hdr{padding:8px 14px}
  .hl{font-size:17px;letter-spacing:2px}
  .hl-sub{display:none}
  .nav{padding:0 10px}
  .nt{padding:11px 10px;font-size:12px;letter-spacing:.5px}
  .stg{padding:12px}
  .cap-main{padding:12px}
  .spl{padding:16px;margin-bottom:10px}
  .bid-stage{padding:14px}
  .bb{padding:11px;margin-bottom:10px}
  .ar{gap:6px}
  .sdb,.usb{padding:11px;font-size:17px}
  .ss{padding:10px}
  .tfs{gap:5px;padding:0 10px 10px}
  .tfh{padding:12px}
  /* Login */
  .lhero-parsippany{font-size:34px;letter-spacing:4px}
  .lhero-title{font-size:34px;letter-spacing:4px}
  .lhero-teams{gap:12px;padding:14px 16px}
  .lb{padding:22px 20px}
}

/* ─── MOBILE 480px ─── */
@media(max-width:480px){
  /* Header compact */
  .hdr{padding:7px 10px;gap:5px}
  .hlw{gap:7px}
  .hl{font-size:15px;letter-spacing:1.5px}
  .hr{gap:5px}
  .rp{display:none}
  .xb,.nb{padding:5px 8px;font-size:10px}
  /* Nav scrollable tight */
  .nav{padding:0 6px;gap:1px}
  .nt{padding:10px 8px;font-size:11px;letter-spacing:0}
  /* Auction stage */
  .stg{padding:8px}
  .spl{padding:12px;border-radius:14px}
  .pav{width:64px;height:64px;font-size:15px}
  .pn{font-size:20px;letter-spacing:1.5px;margin-bottom:5px}
  .pm{gap:5px;margin-bottom:10px}
  .ch{padding:3px 8px;font-size:10px}
  .tt{font-size:9px;padding:3px 10px;margin-bottom:8px}
  .bb{padding:10px;margin-bottom:10px;border-radius:10px}
  .bl{font-size:8px}
  .ba{font-size:28px}
  .bs{font-size:10px}
  /* Bid buttons — 3 cols always */
  .bg{grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:7px}
  .tbb{padding:8px 5px;border-radius:8px;font-size:10px}
  .ar{gap:5px}
  .sdb{font-size:16px;padding:10px;border-radius:9px}
  .usb{font-size:16px;padding:10px;border-radius:9px}
  /* Sidebar */
  .sb{max-height:200px}
  .sbt{font-size:8px;margin-bottom:8px}
  .tc{padding:8px;margin-bottom:5px}
  .sc{font-size:8px}
  .lt{font-size:9px}
  .lr{padding:4px 0}
  /* Captain */
  .cap-pts-strip{grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:12px}
  .cs{padding:9px 6px}
  .csv{font-size:18px}
  .csl{font-size:7px}
  .bid-stage{padding:12px;border-radius:14px;margin-bottom:12px}
  .cbd-amount{font-size:34px!important}
  .cbb{font-size:18px;padding:14px;letter-spacing:2px}
  .cap-main{padding:8px}
  .cap-side-sec{padding:10px}
  .cap-side-title{font-size:8px;margin-bottom:8px}
  .cap-sq-name{font-size:10px}
  .cap-sq-role{font-size:8px}
  .cap-sq-price{font-size:10px}
  /* Login */
  .lhero-parsippany{font-size:26px;letter-spacing:3px}
  .lhero-title{font-size:26px;letter-spacing:3px}
  .lhero-sep{font-size:26px}
  .lhero-tag{font-size:9px;letter-spacing:2px}
  .lhero-teams{flex-wrap:wrap;gap:8px;padding:10px}
  .lhero-team-name{font-size:8px;letter-spacing:1px}
  .lb{padding:16px 14px;border-radius:16px}
  .ls{font-size:11px;margin-bottom:14px}
  .rg{gap:6px}
  .rb{padding:12px 6px;border-radius:10px}
  .ri{font-size:20px;margin-bottom:3px}
  .rn{font-size:12px}
  .rh{font-size:8px}
  .inp{padding:10px 12px;font-size:13px}
  .gb{padding:12px;font-size:17px}
  /* Teams / Players grid */
  .tgrid{grid-template-columns:1fr;gap:8px;padding:8px}
  .pgg{grid-template-columns:repeat(2,1fr);gap:6px}
  .sqg{grid-template-columns:repeat(2,1fr);gap:6px}
  .pgw{padding:8px}
  .fr{gap:4px;margin-bottom:10px}
  .fb{font-size:10px;padding:4px 9px}
  .pc{padding:10px}
  .pcav{width:34px;height:34px;font-size:9px}
  .pcn{font-size:12px}
  .pcr{font-size:8px}
  /* Round banner */
  .rbn{padding:20px 12px}
  .rbt{font-size:28px;letter-spacing:2px}
  .rbb{padding:12px 28px;font-size:18px;letter-spacing:2px}
  .rbd{font-size:12px;margin-bottom:18px}
  /* Popups */
  .viewer-sold-popup{padding:24px 18px;border-radius:16px}
  .vsp-player{font-size:28px}
  .cap-celeb-popup{padding:24px 18px;border-radius:18px}
  .celeb-title{font-size:32px;letter-spacing:3px}
  .celeb-player{font-size:24px}
  /* Misc */
  .done{padding:28px 12px}
  .dtl{font-size:32px;letter-spacing:3px}
  .rbe{font-size:9px;letter-spacing:2px}
  .vtk{padding:7px 10px;gap:7px}
  .vtxt{font-size:10px}
}

/* ─── TINY PHONES 360px ─── */
@media(max-width:360px){
  .lhero-parsippany,.lhero-title{font-size:22px;letter-spacing:2px}
  .nt{padding:8px 5px;font-size:10px}
  .pgg,.sqg{grid-template-columns:1fr}
  .bg{grid-template-columns:repeat(3,1fr);gap:3px}
  .tbb{padding:7px 4px;font-size:9px}
  .csv{font-size:16px}
  .ba{font-size:24px}
  .sdb,.usb{font-size:14px;padding:9px}
  .cbb{font-size:16px;padding:12px}
}
`;

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [fbReady,setFbReady]=useState<boolean>(()=>{try{initFB(FULL_FB_CONFIG);return true;}catch{return false;}});
  const [role,setRole]=useState<Role>("login");
  const [teamId,setTeamId]=useState<number|null>(null);
  const [st,setSt]=useState<AuctionState>(INIT_STATE);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  // Viewer sold popup
  const [viewerPopup,setViewerPopup]=useState<AuctionState["lastSold"]|null>(null);
  // Captain celebration popup
  const [celebPopup,setCelebPopup]=useState<{playerName:string;price:number;purseLeft:number}|null>(null);

  const prevLastSold=useRef<string|null>(null);
  const prevCurBidder=useRef<number|null>(null);

  useEffect(()=>{
    if(!fbReady){setLoading(false);return;}
    initAuth().catch(()=>{}); // write hashed passwords to Firebase on first run
    let unsub:(()=>void)|null=null;
    try{
      unsub=onValue(fbRef(),snap=>{
        try{
          if(snap.exists()){
            const raw=snap.val() as AuctionState;
            if(!raw.dataVersion||raw.dataVersion<DATA_VERSION){
              writeSt(INIT_STATE).catch(()=>{});setSt(INIT_STATE);
            } else {
              const safe:AuctionState={
                ...INIT_STATE,...raw,
                ...safeParse(raw),
                lastSold:raw.lastSold??null,
              };
              setSt(safe);
              // Trigger viewer popup when lastSold changes
              if(raw.lastSold){
                const key=`${raw.lastSold.playerName}-${raw.lastSold.teamId}`;
                if(key!==prevLastSold.current){
                  prevLastSold.current=key;
                  setViewerPopup(raw.lastSold);
                  setTimeout(()=>setViewerPopup(null),4500);
                }
              }
            }
          } else { writeSt(INIT_STATE).catch(()=>{}); setSt(INIT_STATE); }
        } catch { setSt(INIT_STATE); }
        setLoading(false);
      },()=>setLoading(false));
    } catch { setLoading(false); }
    return ()=>{ unsub&&unsub(); };
  },[fbReady]);

  const addLog=(prev:AuctionState,icon:string,text:string):LogItem[]=>{
    const time=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    return [{icon,text,time},...safeArr(prev.log).slice(0,59)];
  };
  // Direct Firebase functions — no useCallback stale closure issues
  const write=async(next:AuctionState)=>{try{await set(ref(getDb(),"psAuction_v23"),next);}catch(e){console.error("write error",e);}};
  const patch=async(p:Partial<AuctionState>)=>{try{await update(ref(getDb(),"psAuction_v23"),p);}catch(e){console.error("patch error",e);}};

  const startRound=async(round:number)=>{
    const snap=await readSt(); // needs fresh data to get unsold players
    const captainIds=Object.values(CAPTAIN_MAP);
    const sorted=[...safeArr(snap.players)]
      .filter(p=>!captainIds.includes(p.id)) // exclude captains from auction
      .sort((a,b)=>b.basePrice-a.basePrice);
    const queue=round===1?sorted.map(p=>p.id):sorted.filter(p=>p.soldTo===null).map(p=>p.id);
    if(!queue.length){alert("No unsold players!");return;}
    const first=snap.players.find(p=>p.id===queue[0]);
    const log=addLog(snap,"🎙️",`Round ${round} started! ${queue.length} players.`);
    await set(ref(getDb(),"psAuction_v23"),{...snap,queue,curIdx:0,curBid:0,curBidder:null,firstBidder:null,aRound:round,phase:"running",showSold:false,log,lastSold:null});
  };

  const placeBid=async(tid:number)=>{
    // Use local st directly — already live-synced via onValue, no need for readSt()
    const snap=st;
    const cp=safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[snap.curIdx]);
    if(!cp||snap.phase!=="running")return;
    const team=safeArr(snap.teams).find(t=>t.id===tid);
    if(!team)return;
    const safeCurBid = snap.curBidder !== null
      ? Math.max(snap.curBid, cp.basePrice)
      : 0;
    const nb = snap.curBidder === null
      ? cp.basePrice
      : snap.curBidder === tid
        ? safeCurBid
        : safeCurBid + MIN_BID;
    if(team.purse<nb)return;
    const skipped=safeArr(snap.skippedTeams).filter(id=>id!==tid);
    const firstBidder=snap.firstBidder!==null?snap.firstBidder:(snap.curBidder===null?tid:snap.firstBidder);
    const log=addLog(snap,"💰",`${team.short} bid ${fmt(nb)} for ${cp.name}`);
    await update(ref(getDb(),"psAuction_v23"),{curBid:nb,curBidder:tid,firstBidder,log,skippedTeams:skipped});
  };

  // SKIP: captain passes on this player. If ALL teams have skipped → mark unsold.
  const doSkip=async(tid:number)=>{
    const snap=st; // use local state
    const cp=safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[snap.curIdx]);
    if(!cp||snap.phase!=="running")return;
    const team=safeArr(snap.teams).find(t=>t.id===tid);
    if(!team)return;
    const skipped=[...new Set([...safeArr(snap.skippedTeams),tid])];
    const activeBidders=safeArr(snap.teams).filter(t=>
      t.marqueeCount<MAX_MARQUEE && // marqueeCount is reliable
      t.purse>=(snap.curBidder===null?cp.basePrice:snap.curBidder===t.id?Math.max(snap.curBid,cp.basePrice):Math.max(snap.curBid,cp.basePrice)+MIN_BID) &&
      !skipped.includes(t.id)
    );
    const log=addLog(snap,"⏭️",`${team.short} passed on ${cp.name}`);
    if(activeBidders.length===0){
      // All teams skipped → auto unsold
      const log2=addLog({...snap,log},"❌",`${cp.name} UNSOLD — all teams passed`);
      await update(ref(getDb(),"psAuction_v23"),{log:log2,skippedTeams:[],lastSold:null,firstBidder:null});
      advance();
    } else {
      await update(ref(getDb(),"psAuction_v23"),{log,skippedTeams:skipped,firstBidder:snap.firstBidder??null});
    }
  };

  const doSold=async()=>{
    const snap=await readSt(); // MUST use fresh state — marqueeCount must be accurate
    if(snap.curBidder===null)return;
    const cp=safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[snap.curIdx]);
    if(!cp)return;
    const team=safeArr(snap.teams).find(t=>t.id===snap.curBidder);
    if(!team)return;
    const soldPrice=Math.max(snap.curBid, cp.basePrice); // safety: never below base
    const sp:SquadPlayer={...cp,soldPrice,isMarquee:true,round:snap.aRound};
    const newTeams=safeArr(snap.teams).map(t=>t.id===snap.curBidder
      ?{...t,purse:t.purse-soldPrice,squad:[...safeArr(t.squad),sp],marqueeCount:t.marqueeCount+1}:t);
    const newPlayers=safeArr(snap.players).map(p=>p.id===cp.id?{...p,soldTo:snap.curBidder,soldPrice,round:snap.aRound}:p);
    const log=addLog(snap,"🔨",`SOLD! ${cp.name} → ${team.short} for ${fmt(soldPrice)}`);
    const lastSold={playerName:cp.name,teamName:team.name,teamColor:team.color,teamId:team.id,price:soldPrice};
    // Captain celebration: if the winning captain is viewing this session
    const winnerTeam=newTeams.find(t=>t.id===snap.curBidder);
    if(teamId===snap.curBidder&&winnerTeam){
      setCelebPopup({playerName:cp.name,price:snap.curBid,purseLeft:winnerTeam.purse});
    }
    await set(ref(getDb(),"psAuction_v23"),{...snap,teams:newTeams,players:newPlayers,showSold:true,log,lastSold,firstBidder:snap.firstBidder??null});
    setTimeout(()=>advance(),2100);
  };

  const doUnsold=async()=>{
    const snap=await readSt();
    const cp=safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[snap.curIdx]);
    if(!cp)return;
    const newPlayers=safeArr(snap.players).map(p=>
      p.id===cp.id?{...p,soldTo:null,soldPrice:null,round:null}:p
    );
    const log=addLog(snap,"❌",`${cp.name} UNSOLD`);
    await set(ref(getDb(),"psAuction_v23"),{
      ...snap,players:newPlayers,log,lastSold:null,firstBidder:null,showSold:false
    });
    setTimeout(()=>advance(),600);
  };

  // Assign current player to a broke team at base price (0 pts deducted)
  const doAssignFree=async(teamId:number)=>{
    const snap=await readSt(); // fresh state
    const cp=safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[snap.curIdx]);
    if(!cp||snap.phase!=="running")return;
    const team=safeArr(snap.teams).find(t=>t.id===teamId);
    if(!team)return;
    const sp:SquadPlayer={...cp,soldPrice:0,isMarquee:true,round:snap.aRound,isCaptain:false};
    const newTeams=safeArr(snap.teams).map(t=>t.id===teamId
      ?{...t,squad:[...safeArr(t.squad),sp],marqueeCount:t.marqueeCount+1}:t);
    const newPlayers=safeArr(snap.players).map(p=>p.id===cp.id
      ?{...p,soldTo:teamId,soldPrice:0,round:snap.aRound}:p);
    const log=addLog(snap,"🎁",`${cp.name} → ${team.short} (base price — purse empty)`);
    const lastSold={playerName:cp.name,teamName:team.name,teamColor:team.color,teamId:team.id,price:0};
    await set(ref(getDb(),"psAuction_v23"),{...snap,teams:newTeams,players:newPlayers,showSold:true,log,lastSold,firstBidder:null});
    setTimeout(()=>advance(),2100);
  };

  const advance=async()=>{
    const snap=await readSt();
    const captainIds=Object.values(CAPTAIN_MAP);

    const next=snap.curIdx+1;

    // ── More players in queue → go to next ───────────────────────────────
    if(next<safeArr(snap.queue).length){
      await update(ref(getDb(),"psAuction_v23"),{
        curIdx:next,curBid:0,curBidder:null,firstBidder:null,
        showSold:false,lastSold:null,skippedTeams:[]
      });
      return;
    }

    // ── Queue finished — MANDATORY RULE: every team must have 7 picks ────
    // Count how many picks each team still needs
    const allSoldIdsCheck=new Set(
      safeArr(snap.teams).flatMap(t=>safeArr(t.squad).map((s:any)=>s.id))
    );
    const teamsNotFull=safeArr(snap.teams).filter(t=>{
      const squadSize=safeArr(t.squad).length;
      return squadSize<MAX_SQUAD;
    });
   
    // Reliable unsold count: players processed in queue but not in any squad
    const allSoldIds=new Set(
      safeArr(snap.teams).flatMap(t=>safeArr(t.squad).map((s:any)=>s.id))
    );
    const soldInSquads=safeArr(snap.teams).reduce((sum,t)=>
      sum+safeArr(t.squad).filter((s:any)=>!captainIds.includes(s.id)).length,0
    );
    const processedIds=safeArr(snap.queue).slice(0,snap.curIdx+1);
    const unsoldPlayers=safeArr(snap.players)
      .filter(p=>!captainIds.includes(p.id)
        && processedIds.includes(p.id)
        && !allSoldIds.has(p.id));
    console.log(`ADVANCE: processed=${processedIds.length} soldInSquads=${soldInSquads} unsold=${unsoldPlayers.length} teamsNotFull=${teamsNotFull.length}`);

    // If all teams have 7 picks → auction truly complete
    if(teamsNotFull.length===0){
      const log=addLog(snap,"🏆","All teams have 7 players each! Auction complete!");
      await set(ref(getDb(),"psAuction_v23"),{
        ...snap,showSold:false,aDone:true,phase:"done",
        log,lastSold:null,rotatingPool:unsoldPlayers.map(p=>p.id)
      });
      return;
    }

    // NOT all teams full — MUST show roundDone so admin can assign
    const needCounts=teamsNotFull.map(t=>`${t.short} needs ${MAX_MARQUEE-t.marqueeCount} more`).join(", ");
    const msg=unsoldPlayers.length>0
      ? `Round ${snap.aRound} done. ${unsoldPlayers.length} unsold players re-enter. Still needed: ${needCounts}.`
      : `Round ${snap.aRound} done. No unsold players left — admin must assign remaining slots. ${needCounts}.`;
    const log=addLog(snap,"⏸️",msg);
    await set(ref(getDb(),"psAuction_v23"),{
      ...snap,showSold:false,phase:"roundDone",log,lastSold:null,
      skippedTeams:[],rotatingPool:unsoldPlayers.map(p=>p.id)
    });
  };

  const startNextRound=async()=>{
    const snap=await readSt();
    const captainIds=Object.values(CAPTAIN_MAP);
    const allSoldIdsNR=new Set(
      safeArr(snap.teams).flatMap(t=>safeArr(t.squad).map((s:any)=>s.id))
    );
    const unsold=safeArr(snap.players)
  .filter(p=>!captainIds.includes(p.id) && !allSoldIdsNR.has(p.id));
    if(unsold.length===0){
      alert("No unsold players to auction. Please use the ASSIGN AT BASE buttons to complete remaining team slots.");
      return;
    }
    const newQueue=unsold.sort((a,b)=>b.basePrice-a.basePrice).map(p=>p.id);
    const nextRound=snap.aRound+1;
    const log=addLog(snap,"🎙️",`Round ${nextRound} started! ${newQueue.length} unsold players.`);
    await set(ref(getDb(),"psAuction_v23"),{
      ...snap,
      queue:newQueue,curIdx:0,curBid:0,curBidder:null,firstBidder:null,
      aRound:nextRound,phase:"running",showSold:false,
      log,lastSold:null,skippedTeams:[],
    });
  };
  const resetAll=async()=>{if(!confirm("Reset ALL data?"))return;prevLastSold.current=null;await writeSt(INIT_STATE);};
  const logout=()=>{setRole("login");setTeamId(null);};
  const curPlayer=safeArr(st.queue).length>0?safeArr(st.players).find(p=>p.id===st.queue[st.curIdx]):undefined;
  const leadTeam=st.curBidder!==null?safeArr(st.teams).find(t=>t.id===st.curBidder):undefined;
  const soldCount=safeArr(st.players).filter(p=>p.soldTo!==null&&!Object.values(CAPTAIN_MAP).includes(p.id)).length;
  const progPct=safeArr(st.queue).length>0?Math.round((st.curIdx/st.queue.length)*100):0;
  const myTeam=teamId!==null?safeArr(st.teams).find(t=>t.id===teamId):undefined;
  const canBid=useCallback((team:Team):boolean=>{
    if(st.showSold||!curPlayer||st.phase!=="running")return false;
    if(team.marqueeCount>=MAX_MARQUEE)return false; // marqueeCount is the reliable counter
    // Price rule: first bid = base; outbidding = +10; safe floor prevents 0+10 bug
    const safeCur=Math.max(st.curBid, st.curBidder!==null?curPlayer.basePrice:0);
    const nb=st.curBidder===null
      ? curPlayer.basePrice             // no one has bid → base price (100)
      : st.curBidder===team.id
        ? safeCur                       // already leading → same
        : safeCur+MIN_BID;              // outbidding → +10
    if(team.purse<nb)return false;
    if(team.id===st.curBidder)return false; // already leading, no need to rebid
    return true;
  },[st,curPlayer]);

  const hasSkipped=useCallback((teamId:number):boolean=>{
    return safeArr(st.skippedTeams).includes(teamId);
  },[st]);


  // Firebase always ready — no setup screen needed
  if(loading)return(<><style>{CSS}</style><div className="conn"><div className="spin"/><div style={{color:"var(--cyan)",fontSize:13,letterSpacing:1}}>Connecting to Parstriker…</div></div></>);

  return(<>
    <style>{CSS}</style>
    {saving&&<div className="sync-toast">⚡ Syncing…</div>}

    {/* Viewer sold popup */}
    {role==="viewer"&&viewerPopup&&(
      <div className="overlay-backdrop" onClick={()=>setViewerPopup(null)}>
        <div className="viewer-sold-popup" style={{borderColor:viewerPopup.teamColor}} onClick={e=>e.stopPropagation()}>
          <div style={{fontSize:36,marginBottom:4}}>🔨</div>
          <div style={{fontSize:10,color:"var(--mut)",letterSpacing:3,textTransform:"uppercase",marginBottom:4}}>Player Selected!</div>
          <div className="vsp-player" style={{color:"var(--txt)"}}>{viewerPopup.playerName}</div>
          <div className="vsp-selected">SELECTED BY</div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,margin:"8px 0 12px"}}>
            <TeamLogo teamId={viewerPopup.teamId} size={44}/>
            <div className="vsp-team" style={{color:viewerPopup.teamColor}}>{viewerPopup.teamName}</div>
          </div>
          <button className="vsp-close" onClick={()=>setViewerPopup(null)}>DISMISS</button>
        </div>
      </div>
    )}

    {/* Captain celebration popup */}
    {role==="captain"&&celebPopup&&(
      <div className="overlay-backdrop">
        <div className="cap-celeb-popup">
          {/* Flying emoji rain in background */}
          <div className="celeb-rain">
            {["🎉","🏏","⭐","🎊","💰","🏆","✨","🎯","🥳","💫"].map((e,i)=>(
              <span key={i} className="celeb-emoji" style={{
                left:`${8+i*9}%`,
                animationDuration:`${1.2+i*0.15}s`,
                animationDelay:`${i*0.1}s`,
                fontSize:`${18+Math.abs(i%3)*6}px`,
              }}>{e}</span>
            ))}
          </div>
          {/* Content */}
          <div style={{position:"relative",zIndex:1}}>
            <div style={{fontSize:52,marginBottom:4,animation:"confettiFall .6s ease-out infinite alternate"}}>🏆</div>
            <div className="celeb-title">YOU GOT HIM!</div>
            <div className="celeb-player">{celebPopup.playerName}</div>
            <div style={{fontSize:10,color:"var(--mut)",letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Secured for</div>
            <div className="celeb-price">{fmt(celebPopup.price)}</div>
            <div style={{display:"flex",justifyContent:"center",gap:16,margin:"14px 0",flexWrap:"wrap"}}>
              <div style={{background:"rgba(52,211,153,.1)",border:"1px solid rgba(52,211,153,.3)",borderRadius:10,padding:"8px 16px"}}>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:"var(--ok)"}}>{fmt(celebPopup.purseLeft)}</div>
                <div style={{fontSize:9,color:"var(--mut)",letterSpacing:1}}>PURSE LEFT</div>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"center",gap:6,marginBottom:16,fontSize:26}}>
              {["🎊","🎉","🏏","🎉","🎊"].map((e,i)=>(
                <span key={i} style={{display:"inline-block",animation:`confettiFall ${0.7+i*0.12}s ease-out infinite alternate`}}>{e}</span>
              ))}
            </div>
            <button className="celeb-close" onClick={()=>setCelebPopup(null)}>AWESOME! 🎯</button>
          </div>
        </div>
      </div>
    )}

    {role==="login"&&<LoginScreen teams={safeArr(st.teams)} onLogin={(r,tid)=>{setRole(r);if(tid!==undefined)setTeamId(tid);}}/>}
    {role==="admin"&&<AdminView st={st} curPlayer={curPlayer} leadTeam={leadTeam} soldCount={soldCount} progPct={progPct} onBid={placeBid} onSold={doSold} onUnsold={doUnsold} onSkip={doSkip} onAssignFree={doAssignFree} onStartRound={startRound} onNextRound={startNextRound} onLogout={logout} onReset={resetAll} canBid={canBid} hasSkipped={hasSkipped}/>}
    {role==="captain"&&myTeam&&<CaptainView myTeam={myTeam} st={st} curPlayer={curPlayer} onBid={placeBid} onSkip={doSkip} onLogout={logout} canBid={canBid} hasSkipped={hasSkipped}/>}
    {role==="viewer"&&<ViewerView st={st} curPlayer={curPlayer} leadTeam={leadTeam} soldCount={soldCount} onLogout={logout}/>}
  </>);
}

// ─── FIREBASE SETUP ───────────────────────────────────────────────────────────
function FirebaseSetup({onSave}:{onSave:(c:FBConfig)=>void}){
  const [sid,setSid]=useState("");const [err,setErr]=useState("");
  const save=()=>{
    setErr("");
    const id=sid.trim();
    if(!id){setErr("Please enter Messaging Sender ID");return;}
    if(!/^\d+$/.test(id)){setErr("Numbers only — no spaces");return;}
    onSave({...PREFILLED as FBConfig,messagingSenderId:id});
  };
  return(
    <div className="sw">
      <div className="sb2">
        {/* Logo + title */}
        <div style={{textAlign:"center",marginBottom:28}}>
          <LogoParstriker size={72}/>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:6,marginTop:10,
            background:"linear-gradient(90deg,#FFD700,#00e5ff)",WebkitBackgroundClip:"text",
            WebkitTextFillColor:"transparent",backgroundClip:"text"}}>PARSTRIKER</div>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:12,letterSpacing:5,color:"var(--mut)",marginTop:2}}>AUCTION</div>
        </div>

        {/* Only field needed */}
        {err&&<div className="serr">⚠ {err}</div>}
        <div className="sfield">
          <label className="slbl">Messaging Sender ID</label>
          <input className="sinp" placeholder="Enter Sender ID" value={sid}
            onChange={e=>setSid(e.target.value.trim())}
            onKeyDown={e=>e.key==="Enter"&&save()} autoFocus/>
        </div>

        <button className="sbtn" onClick={save}>🔥 CONNECT &amp; LAUNCH</button>
      </div>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({teams,onLogin}:{teams:Team[];onLogin:(r:Role,tid?:number)=>void}){
  const [sel,setSel]=useState<Role|null>(null);const [pass,setPass]=useState("");const [err,setErr]=useState("");
  const [checking,setChecking]=useState(false);
  const tryLogin=async()=>{
    setErr("");
    if(!sel)return;
    if(sel==="viewer"){onLogin("viewer");return;}
    setChecking(true);
    try{
      if(sel==="admin"){
        const ok=await verifyPass(pass,"admin");
        ok?onLogin("admin"):setErr("Wrong admin password");
      } else {
        // Try each captain role
        const roles:["bi"|"rk"|"ww",number][]=[["bi",1],["rk",2],["ww",3]];
        let matched=false;
        for(const [role,teamId] of roles){
          const ok=await verifyPass(pass,role);
          if(ok){onLogin("captain",teamId);matched=true;break;}
        }
        if(!matched)setErr("Wrong captain password");
      }
    }catch{setErr("Connection error — try again");}
    setChecking(false);
  };
  return(
    <div className="lw">
      <div className="lhero">
        {/* One-line headline: PARSIPPANY PARSTRIKER */}
        <div className="lhero-headline">
          <div className="lhero-parsippany">PARSIPPANY</div>
          <div className="lhero-sep">·</div>
          <div className="lhero-title">PARSTRIKER</div>
        </div>
        <div className="lhero-tag">— UNLEASHING THE SPIRIT OF CRICKET —</div>
        {/* Team logos row */}
        <div className="lhero-teams">
          <div className="lhero-team">
            <TeamLogo teamId={1} size={52}/>
            <div className="lhero-team-name" style={{color:"#1a56db"}}>BLUE INDIANS</div>
          </div>
          <div style={{width:1,height:60,background:"rgba(124,58,237,.25)"}}/>
          <div className="lhero-team">
            <TeamLogo teamId={2} size={52}/>
            <div className="lhero-team-name" style={{color:"#c41e3a"}}>RED KNIGHTS</div>
          </div>
          <div style={{width:1,height:60,background:"rgba(124,58,237,.25)"}}/>
          <div className="lhero-team">
            <TeamLogo teamId={3} size={52}/>
            <div className="lhero-team-name" style={{color:"#b0b8c8"}}>WHITE WOLVES</div>
          </div>
        </div>
      </div>
      <div className="lb">
        <div className="ls">Select your role to enter the auction</div>
        <div className="rg">
          {([["admin","🎙️","Admin","Auction control"],["captain","👑","Captain","Bid players"],["viewer","👁️","Viewer","Watch live"]] as const).map(([r,ic,nm,hn])=>(
            <div key={r} className={`rb ${sel===r?"sel":""}`} onClick={()=>{setSel(r as Role);setPass("");setErr("");}}>
              <div className="ri">{ic}</div><div className="rn">{nm}</div><div className="rh">{hn}</div>
            </div>
          ))}
        </div>
        {err&&<div className="em">⚠ {err}</div>}
        {sel&&sel!=="viewer"&&<input className="inp" type="password" placeholder={sel==="admin"?"Admin password":"Captain password"} value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&tryLogin()}/>}
        {sel==="viewer"&&<div style={{fontSize:11,color:"var(--mut)",marginBottom:10,textAlign:"center"}}>No password required</div>}
        <button className="gb" disabled={!sel||checking} onClick={tryLogin}>{checking?"Checking…":"ENTER"}</button>
        <div className="ht">Contact the auction organiser for your password</div>
      </div>
      <Footer/>
    </div>
  );
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
function AdminView({st,curPlayer,leadTeam,soldCount,progPct,onBid,onSold,onUnsold,onSkip,onAssignFree,onStartRound,onNextRound,onLogout,onReset,canBid,hasSkipped}:{
  st:AuctionState;curPlayer:Player|undefined;leadTeam:Team|undefined;soldCount:number;progPct:number;
  onBid:(id:number)=>void;onSold:()=>void;onUnsold:()=>void;onSkip:(id:number)=>void;onAssignFree:(id:number)=>void;onStartRound:(r:number)=>void;onNextRound:()=>void;onLogout:()=>void;onReset:()=>void;canBid:(t:Team)=>boolean;hasSkipped:(id:number)=>boolean;
}){
  const [tab,setTab]=useState<"auction"|"players"|"teams">("auction");
  const [filter,setFilter]=useState("All");
  const teams=safeArr(st.teams); const players=safeArr(st.players);
  const auctionPlayers=players.filter(p=>!Object.values(CAPTAIN_MAP).includes(p.id));

  return(<div>
    <div className="hdr">
      <div className="hlw"><LogoParstriker size={36}/><div><div className="hl">PARSTRIKER AUCTION</div><div className="hl-sub">ADMIN CONTROL</div></div></div>
      <div className="hr">
        <span className="rp" style={{background:"rgba(255,215,0,.1)",color:"var(--gold)",borderColor:"rgba(255,215,0,.3)"}}>🎙️ ADMIN</span>
        <button className="xb" onClick={onLogout}>Logout</button>
        <button className="nb" onClick={onReset}>Reset</button>
      </div>
    </div>
    <div className="nav">
      {(["auction","players","teams"] as const).map(t=>(
        <button key={t} className={`nt ${tab===t?"on":""}`} onClick={()=>setTab(t)}>
          {t==="auction"?"🔨 AUCTION":t==="players"?"🏏 PLAYERS":"🏆 TEAMS"}
        </button>
      ))}
    </div>

    {tab==="auction"&&(
      st.aDone?<DoneScreen teams={teams} players={players} rotatingPool={safeArr(st.rotatingPool)}/>:
      st.phase==="roundDone"?(()=>{
        const captainIds=Object.values(CAPTAIN_MAP);
        // Squad-based unsold detection — reliable regardless of Firebase array ordering
      const allSoldIdsRD=new Set(
        safeArr(st.teams).flatMap(t=>safeArr(t.squad).map((s:any)=>s.id))
      );
      const unsoldPs=safeArr(st.players)
      .filter(p=>!captainIds.includes(p.id) && !allSoldIdsRD.has(p.id));
      const teamsNeedMore=safeArr(st.teams).filter(t=>safeArr(t.squad).length<MAX_SQUAD);
        return(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            padding:"48px 24px",textAlign:"center"}}>
            <div style={{fontSize:52,marginBottom:12}}>✅</div>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:38,letterSpacing:4,color:"var(--gold)",marginBottom:8}}>
              ROUND {st.aRound} COMPLETE
            </div>
            <div style={{fontSize:14,color:"var(--mut)",marginBottom:8}}>
              <span style={{color:"var(--warn)",fontWeight:700,fontSize:18}}>{unsoldPs.length} unsold players</span> ready for Round {st.aRound+1}
            </div>
            <div style={{display:"flex",gap:12,marginBottom:24}}>
              {teamsNeedMore.map(t=>(
                <span key={t.id} style={{color:t.color,fontWeight:700,fontSize:13}}>
                  {t.short}: {safeArr(t.squad).length}/{MAX_SQUAD}
                </span>
              ))}
            </div>
            {/* Unsold players list */}
            <div style={{display:"flex",flexWrap:"wrap",gap:7,justifyContent:"center",marginBottom:28,maxWidth:520}}>
              {unsoldPs.map(p=>(
                <div key={p.id} style={{background:"rgba(124,58,237,.12)",border:"1px solid rgba(124,58,237,.25)",
                  borderRadius:8,padding:"4px 12px",fontSize:12,color:"var(--txt)"}}>
                  {p.name} · {p.role}
                </div>
              ))}
            </div>
            {/* Broke teams — assign at base */}
            {teamsNeedMore.length>0&&unsoldPs.length>0&&(
              <div style={{marginBottom:24,padding:"14px 20px",background:"rgba(52,211,153,.07)",
                border:"1px solid rgba(52,211,153,.3)",borderRadius:12,maxWidth:440,width:"100%"}}>
                <div style={{fontSize:12,color:"#34d399",marginBottom:10,fontWeight:700,letterSpacing:1}}>
                 🎁 ASSIGN TO TEAM — assign next unsold player at base price
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
                  {teamsNeedMore.map(t=>(
                    <button key={t.id}
                      style={{padding:"9px 18px",background:"rgba(52,211,153,.18)",
                        border:"2px solid rgba(52,211,153,.5)",borderRadius:9,
                        color:"#34d399",fontFamily:"'Bebas Neue'",fontSize:14,cursor:"pointer",letterSpacing:1}}
                      onClick={()=>{
                        if(unsoldPs.length===0){alert("No unsold players!");return;}
                        // Show player selection dialog
                        const playerNames=unsoldPs.map((p,i)=>`${i+1}. ${p.name} (${p.role})`).join("\n");
                        const choice=prompt(`Select player for ${t.name}:\n\n${playerNames}\n\nEnter number (1-${unsoldPs.length}):`);
                        if(!choice)return;
                        const idx=parseInt(choice)-1;
                        if(isNaN(idx)||idx<0||idx>=unsoldPs.length){alert("Invalid selection");return;}
                        const p=unsoldPs[idx];
                        const sp={...p,soldPrice:0,isMarquee:true,round:st.aRound,isCaptain:false};
                        const newTeams=safeArr(st.teams).map(tm=>tm.id===t.id?{...tm,squad:[...safeArr(tm.squad),sp],marqueeCount:tm.marqueeCount+1}:tm);
                        const newPlayers=safeArr(st.players).map(pl=>pl.id===p.id?{...pl,soldTo:t.id,soldPrice:0,round:st.aRound}:pl);
                        const log=[{icon:"🎁",text:`${p.name} → ${t.short} (base — purse empty)`,time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})},...safeArr(st.log).slice(0,59)];
                        set(ref(getDb(),"psAuction_v23"),{...st,teams:newTeams,players:newPlayers,log,lastSold:null});
                      }}>
                      🎁 ASSIGN TO {t.name.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {unsoldPs.length>0?(
              <>
                <button
                  style={{padding:"16px 52px",background:"linear-gradient(135deg,#7c3aed,#4f46e5)",
                    border:"none",borderRadius:14,color:"#fff",fontFamily:"'Bebas Neue'",
                    fontSize:26,letterSpacing:4,cursor:"pointer",
                    boxShadow:"0 4px 24px rgba(124,58,237,.5)",marginTop:8}}
                  onClick={onNextRound}>
                  ▶ START ROUND {st.aRound+1}&nbsp;&nbsp;({unsoldPs.length} PLAYERS)
                </button>
                <div style={{marginTop:12,fontSize:11,color:"var(--mut)"}}>
                  All sold players are locked · Only unsold players re-enter
                </div>
              </>
            ):(
              <div style={{marginTop:8,padding:"16px 24px",
                background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.3)",
                borderRadius:12,maxWidth:500,textAlign:"center"}}>
                <div style={{fontSize:18,color:"var(--gold)",fontWeight:700,marginBottom:8}}>
                  ⚠️ All players were sold — no unsold pool
                </div>
                <div style={{fontSize:12,color:"var(--mut)",lineHeight:2}}>
                  Every player was claimed by a team.<br/>
                  Teams still needing players must be assigned using the<br/>
                  <strong style={{color:"#34d399",fontSize:13}}>🎁 ASSIGN AT BASE</strong> buttons above.<br/>
                  Click the button for each team that still needs picks.
                </div>
              </div>
            )}
            <div style={{marginTop:24,width:"100%"}}><AdminTeamCards teams={teams}/></div>
            <Footer/>
          </div>
        );
      })():
      st.phase==="banner"?(
        <div>
          <div className="rbn">
            <div className="rbe">{st.aRound===0?"WELCOME TO":"🏏 ROUND "+st.aRound+" COMPLETE"}</div>
            <div className="rbt">{st.aRound===0?"PARSTRIKER AUCTION":`ROUND ${st.aRound+1} OF ${TOTAL_ROUNDS}`}</div>
            <div className="rbd">
              {st.aRound===0
                ?`${auctionPlayers.length} players · All at ${fmt(100)} base · ${fmt(PURSE)} budget each`
                :<>
                  <strong style={{color:"var(--gold)"}}>{auctionPlayers.filter(p=>p.soldTo===null).length} unsold players</strong> re-enter the auction<br/>
                  Teams still need players — bidding continues!<br/>
                  <span style={{fontSize:11,opacity:.7}}>Round {st.aRound+1} of {TOTAL_ROUNDS}</span>
                </>
              }
            </div>
            <button className="rbb" onClick={()=>onStartRound(st.aRound+1)}>
              {st.aRound===0?"⚡ START AUCTION":`▶ START ROUND ${st.aRound+1} (${auctionPlayers.filter(p=>p.soldTo===null).length} players)`}
            </button>
          </div>
          <div className="tgrid"><AdminTeamCards teams={teams}/></div>
          <Footer/>
        </div>
      ):(
        <div className="al">
          <div className="stg">
            <div className="st">
              <div style={{display:"flex",alignItems:"center",gap:7}}>
                <div className="rpill">ROUND {st.aRound}/{TOTAL_ROUNDS}</div>
                {""}
              </div>
              <div><div style={{fontSize:9,color:"var(--mut)",marginBottom:3}}>Player {st.curIdx+1}/{safeArr(st.queue).length}</div>
                <div className="pb"><div className="pf" style={{width:`${progPct}%`}}/></div>
              </div>
            </div>
            {curPlayer&&(<>
              <div className="spl">
                {st.showSold&&(<div className="so">
                  <div className="sot">SOLD!</div>
                  <div className="soto">to {leadTeam?.name??""}</div>
                  <div className="sop">{fmt(st.curBid)}</div>
                </div>)}
                <div className="tt" style={{color:tc(curPlayer.tier),borderColor:`${tc(curPlayer.tier)}44`}}>{curPlayer.tier} · {curPlayer.role}</div>
                <div className="pav" style={{borderColor:tc(curPlayer.tier),background:`${tc(curPlayer.tier)}15`,color:tc(curPlayer.tier)}}>{curPlayer.img}</div>
                <div className="pn">{curPlayer.name}</div>
                <div className="pm">
                      <span className="ch">🏏 {curPlayer.role}</span>
                      <span className="ch">Base: {fmt(curPlayer.basePrice)}</span>
                      {(curPlayer.chUrl??"")&&(
                        <a href={curPlayer.chUrl} target="_blank" rel="noopener noreferrer"
                          style={{display:"inline-flex",alignItems:"center",gap:4,
                            padding:"3px 10px",background:"rgba(124,58,237,.12)",
                            border:"1px solid rgba(139,92,246,.35)",borderRadius:14,
                            color:"#a78bfa",fontSize:10,fontWeight:700,textDecoration:"none"}}>
                          🏏 CricHeroes ↗
                        </a>
                      )}
                    </div>
                <div className="bb">
                  <div className="bl">{st.curBidder!==null?"🔥 Current Bid":"🎯 Opening Price — First Bid = Base"}</div>
                  <div className="ba">{fmt(st.curBidder!==null?Math.max(st.curBid,curPlayer?.basePrice??100):curPlayer?.basePrice??100)}</div>
                  <div className="bs">+{fmt(MIN_BID)} pts per raise</div>
                  {leadTeam&&<div className="bldr" style={{color:leadTeam.color}}>🔥 {leadTeam.name} leading</div>}
                </div>
              </div>
              <div className="bg">
                {teams.map(team=>{
                  const able=canBid(team),isLead=team.id===st.curBidder;
                  const skipped=hasSkipped(team.id);
                  // nb = price this team pays if they bid now
                  // Safe floor: max(curBid, basePrice) prevents 0+10=10 bug
                  const safeCurBid=Math.max(st.curBid, st.curBidder!==null?curPlayer.basePrice:0);
                  const nb=st.curBidder===null
                    ? curPlayer.basePrice        // nobody bid yet → base price (100)
                    : isLead
                      ? safeCurBid              // already leading → same price
                      : safeCurBid+MIN_BID;     // outbidding → +10 on real value
                  return(
                    <div key={team.id} style={{display:"flex",flexDirection:"column",gap:4}}>
                      <button className="tbb" disabled={!able}
                        style={{borderColor:isLead?team.color:skipped?"rgba(251,146,60,.4)":"var(--bd)",
                          background:isLead?`${team.color}22`:skipped?"rgba(251,146,60,.06)":"var(--s2)",
                          color:isLead?team.color:"var(--txt)"}}
                        onClick={()=>{
                        const cp3=safeArr(st.players).find((p:Player)=>p.id===safeArr(st.queue)[st.curIdx]);
                        if(!cp3||st.phase!=="running")return;
                        const safeCur3=st.curBidder!==null?Math.max(st.curBid,cp3.basePrice):0;
                        const nb3=st.curBidder===null?cp3.basePrice:safeCur3+MIN_BID;
                        const t3=safeArr(st.teams).find((t:Team)=>t.id===team.id);
                        if(!t3||t3.purse<nb3)return;
                        const skipped3=safeArr(st.skippedTeams).filter((id:number)=>id!==team.id);
                        const fb3=st.firstBidder!==null?st.firstBidder:team.id;
                        const time3=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
                        const log3=[{icon:"💰",text:`${team.short} bid ${fmt(nb3)} for ${cp3.name}`,time:time3},...safeArr(st.log).slice(0,59)];
                        update(ref(getDb(),"psAuction_v23"),{curBid:nb3,curBidder:team.id,firstBidder:fb3,log:log3,skippedTeams:skipped3});
                      }}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                          <TeamLogo teamId={team.id} size={24}/>
                          {able&&<span style={{fontSize:9,color:st.curBidder===null?"var(--ok)":"var(--gold)",fontFamily:"'Bebas Neue'"}}>{fmt(nb)}{st.curBidder===null?" ★":""}</span>}
                        </div>
                        <div className="tdg" style={{background:`${team.color}22`,color:team.color}}>{team.short}</div>
                        <div style={{fontSize:8,opacity:.55,marginTop:2}}>{fmt(team.purse)}</div>
                        {isLead&&<div style={{fontSize:8,color:"var(--ok)",marginTop:1}}>● LEADING</div>}
                        {skipped&&!isLead&&<div style={{fontSize:8,color:"var(--warn)",marginTop:1}}>⏭ PASSED</div>}
                        {team.marqueeCount>=MAX_MARQUEE&&<div style={{fontSize:8,color:"var(--ng)",marginTop:1}}>FULL</div>}
                        {team.purse<100&&team.marqueeCount<MAX_MARQUEE&&(
                          <div style={{fontSize:8,color:"var(--warn)",marginTop:2}}>💰 PURSE EMPTY</div>
                        )}
                        {safeArr(team.squad).length>=MAX_SQUAD&&(
                          <div style={{fontSize:8,color:"var(--ok)",marginTop:2}}>✅ FULL</div>
                        )}
                      </button>
                      {!isLead&&!st.showSold&&st.phase==="running"&&(
                        <button style={{background:"transparent",border:"1px solid rgba(251,146,60,.3)",
                          borderRadius:7,padding:"3px 0",fontSize:9,color:"var(--warn)",cursor:"pointer",
                          fontFamily:"'Rajdhani'",fontWeight:700,letterSpacing:.5}}
                          onClick={()=>onSkip(team.id)}>
                          ⏭ PASS
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* ── ASSIGN TO BROKE TEAM — shown when any team has < 100 pts and needs players ── */}
              {teams.some(t=>t.purse<100&&t.marqueeCount<MAX_MARQUEE)&&(
                <div style={{marginBottom:10,background:"linear-gradient(135deg,rgba(52,211,153,.08),rgba(5,150,105,.05))",
                  border:"1px solid rgba(52,211,153,.35)",borderRadius:12,padding:"10px 12px"}}>
                  <div style={{fontSize:10,color:"#34d399",fontFamily:"'Rajdhani'",fontWeight:700,
                    letterSpacing:1,marginBottom:8,textTransform:"uppercase"}}>
                    🎁 Assign at Base Price — Team Purse Empty
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:`repeat(${teams.filter(t=>t.purse<100&&t.marqueeCount<MAX_MARQUEE).length},1fr)`,gap:6}}>
                    {teams.filter(t=>t.purse<100&&t.marqueeCount<MAX_MARQUEE).map(team=>(
                      <button key={team.id}
                        style={{padding:"10px 8px",background:"linear-gradient(135deg,rgba(52,211,153,.15),rgba(5,150,105,.2))",
                          border:"2px solid rgba(52,211,153,.5)",borderRadius:10,cursor:"pointer",
                          color:"#34d399",fontFamily:"'Bebas Neue'",fontSize:14,letterSpacing:1.5,
                          display:"flex",flexDirection:"column",alignItems:"center",gap:4,
                          transition:"all .2s"}}
                        onClick={()=>onAssignFree(team.id)}
                        onMouseOver={e=>(e.currentTarget.style.background="linear-gradient(135deg,rgba(52,211,153,.25),rgba(5,150,105,.3))")}
                        onMouseOut={e=>(e.currentTarget.style.background="linear-gradient(135deg,rgba(52,211,153,.15),rgba(5,150,105,.2))")}>
                        <TeamLogo teamId={team.id} size={28}/>
                        <span>ASSIGN TO {team.name.toUpperCase()}</span>
                        <span style={{fontSize:10,color:"rgba(52,211,153,.7)",fontFamily:"'DM Sans'",fontWeight:500,letterSpacing:0}}>
                          {safeArr(team.squad).length}/{MAX_SQUAD} players · {MAX_MARQUEE-team.marqueeCount} slots left
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="ar">
                <button className="sdb" disabled={st.curBidder===null||st.showSold} onClick={onSold}>🔨 SOLD</button>
                <button className="usb" disabled={st.showSold} onClick={onUnsold}>❌ UNSOLD</button>
              </div>
            </>)}
          </div>
          <div className="sb">
            <div className="ss">
              <div className="sbt">Team Purses</div>
              {teams.map(team=>{const pct=(team.purse/PURSE)*100;return(
                <div key={team.id} className={`tc ${team.id===st.curBidder?"lead":""}`}>
                  <div className="tr">
                    <div style={{display:"flex",alignItems:"center",gap:6}}><TeamLogo teamId={team.id} size={22}/><span style={{fontSize:11,fontFamily:"'Rajdhani'",fontWeight:700}}>{team.short}</span></div>
                    <span style={{fontSize:10,fontWeight:600,color:pct<20?"var(--ng)":"var(--gold)"}}>{fmt(team.purse)}</span>
                  </div>
                  <div className="pbo"><div className="pbi" style={{width:`${pct}%`,background:pct<20?"var(--ng)":team.color}}/></div>
                  <div className="sc">Squad {safeArr(team.squad).length}/{MAX_SQUAD}</div>
                </div>
              );})}
            </div>
            <div className="ss">
              <div className="sbt">Bid Log</div>
              <div className="ls">
                {safeArr(st.log).length===0&&<div style={{color:"var(--mut)",fontSize:10}}>No activity yet</div>}
                {safeArr(st.log).map((l,i)=>(
                  <div key={i} className="lr"><span className="li">{l.icon}</span>
                    <div style={{flex:1}}><div className="lt">{l.text}</div><div className="ltime">{l.time}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )
    )}
    {tab==="players"&&(
      <div className="pgw">
        <div style={{marginBottom:10}}><div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2}}>Player Pool</div>
          {""}
        </div>

        {/* ── CAPTAINS SECTION ── */}
        <div style={{marginBottom:18}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:14,letterSpacing:3,color:"var(--violet)"}}>👑 TEAM CAPTAINS</div>
            <div style={{flex:1,height:1,background:"linear-gradient(90deg,rgba(124,58,237,.4),transparent)"}}/>
            <div style={{fontSize:10,color:"var(--mut)",background:"rgba(124,58,237,.1)",border:"1px solid rgba(124,58,237,.25)",borderRadius:10,padding:"2px 8px"}}>Pre-assigned · Not in auction</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(155px,1fr))",gap:8}}>
            {teams.map(team=>{
              const capId=CAPTAIN_MAP[team.id];
              const capPlayer=safeArr(players).find(p=>p.id===capId);
              if(!capPlayer) return null;
              return(
                <div key={team.id} style={{background:"linear-gradient(145deg,rgba(124,58,237,.12),rgba(79,70,229,.08))",
                  border:"1px solid rgba(124,58,237,.35)",borderRadius:11,padding:12,
                  position:"relative",overflow:"hidden"}}>
                  {/* Team color strip */}
                  <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:team.color}}/>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,marginTop:4}}>
                    <TeamLogo teamId={team.id} size={28}/>
                    <div style={{fontSize:10,fontFamily:"'Bebas Neue'",letterSpacing:1,color:team.color}}>{team.short}</div>
                  </div>
                  <div style={{width:40,height:40,borderRadius:"50%",display:"flex",alignItems:"center",
                    justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:10,
                    border:`2px solid ${tc(capPlayer.tier)}`,background:`${tc(capPlayer.tier)}15`,
                    color:tc(capPlayer.tier),marginBottom:7}}>{capPlayer.img}</div>
                  <div style={{fontFamily:"'Rajdhani'",fontWeight:700,fontSize:13,color:"#ffffff",marginBottom:2,lineHeight:1.2}}>{capPlayer.name}</div>
                  <div style={{fontSize:9,color:"var(--mut)",marginBottom:6,lineHeight:1.3}}>{capPlayer.role}</div>
                  <div style={{fontSize:8,color:"var(--violet)",background:"rgba(124,58,237,.1)",border:"1px solid rgba(124,58,237,.2)",borderRadius:8,padding:"2px 7px",display:"inline-block",marginBottom:6}}>👑 CAPTAIN</div>
                  {(capPlayer.chUrl??"")&&<a href={capPlayer.chUrl} target="_blank" rel="noopener noreferrer" className="ch-link">🏏 CricHeroes ↗</a>}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── AUCTION PLAYERS ── */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:14,letterSpacing:3,color:"var(--cyan)"}}>🏏 AUCTION POOL</div>
          <div style={{flex:1,height:1,background:"linear-gradient(90deg,rgba(129,140,248,.4),transparent)"}}/>
        </div>
        <div className="fr">{["All","Available","Sold"].map(f=>(<button key={f} className={`fb ${filter===f?"on":""}`} onClick={()=>setFilter(f)}>{f}</button>))}</div>
        <div className="pgg">
          {auctionPlayers.filter(p=>filter==="Available"?p.soldTo===null:filter==="Sold"?p.soldTo!==null:true).map(p=>{
            const sold=p.soldTo!==null?teams.find(t=>t.id===p.soldTo):undefined;
            return(<div key={p.id} className={`pc ${p.soldTo!==null?"sp":""}`}>
              <div className="pcav" style={{borderColor:tc(p.tier),background:`${tc(p.tier)}15`,color:tc(p.tier)}}>{p.img}</div>
              <div className="pcn">{p.name}</div><div className="pcr">{p.role}</div>
              <div className="pctb" style={{color:tc(p.tier)}}>{p.tier}</div>
              {sold?<div className="pcs">✓ {sold.short} · {fmt(p.soldPrice??0)} · R{p.round}</div>:<div className="pcb">Base: {fmt(p.basePrice)}</div>}
              {(p.chUrl??"")&&<a href={p.chUrl} target="_blank" rel="noopener noreferrer" className="ch-link">🏏 CricHeroes ↗</a>}
            </div>);
          })}
        </div>
        <Footer/>
      </div>
    )}
    {tab==="teams"&&<div><div className="tgrid"><AdminTeamCards teams={teams}/></div><Footer/></div>}
  </div>);
}

// ─── CAPTAIN ──────────────────────────────────────────────────────────────────
function CaptainView({myTeam,st,curPlayer,onBid,onSkip,onLogout,canBid,hasSkipped}:{
  myTeam:Team;st:AuctionState;curPlayer:Player|undefined;onBid:(id:number)=>void;onSkip:(id:number)=>void;onLogout:()=>void;canBid:(t:Team)=>boolean;hasSkipped:(id:number)=>boolean;
}){
  const isLeading=st.curBidder===myTeam.id;
  const canBidNow=canBid(myTeam);
  const isSkipped=hasSkipped(myTeam.id);
  const pctLeft=(myTeam.purse/PURSE)*100;
  // nextBid: price this captain would pay if they bid now
  // Uses max(curBid, basePrice) as floor to prevent 0+10=10 display bug
  const base = curPlayer?.basePrice??100;
  const curBidSafe = Math.max(st.curBid, st.curBidder!==null ? base : 0);
  const nextBid=st.curBidder===null
    ? base                              // nobody bid yet → base price (100)
    : st.curBidder===myTeam.id
      ? curBidSafe                      // already leading → show current
      : curBidSafe+MIN_BID;             // outbidding → +10 on top of real curBid
  const squad=safeArr(myTeam.squad);
  const allTeams=safeArr(st.teams);
  const leadTeam=st.curBidder!==null?allTeams.find(t=>t.id===st.curBidder):undefined;

  return(<div>
    <div className="hdr">
      <div className="hlw"><TeamLogo teamId={myTeam.id} size={36}/><div><div className="hl" style={{fontSize:18}}>{myTeam.name}</div><div className="hl-sub">CAPTAIN DASHBOARD</div></div></div>
      <div className="hr">
        <span className="rp" style={{background:`${myTeam.color}20`,color:myTeam.color,borderColor:`${myTeam.color}50`}}>👑 {myTeam.short}</span>
        <button className="xb" onClick={onLogout}>Logout</button>
      </div>
    </div>
    <div className="nav">
      <button className="nt on" style={{color:"var(--gold)",borderBottomColor:"var(--gold)"}}>🎯 LIVE AUCTION</button>
    </div>

    <div className="cap-layout">
      {/* MAIN BIDDING AREA */}
      <div className="cap-main">
        {/* Purse stats strip */}
        <div className="cap-pts-strip">
          <div className={`cap-stat ${pctLeft>50?"glow-gold":pctLeft<20?"glow-red":""}`}>
            <div className="csv" style={{color:pctLeft<20?"var(--ng)":"var(--gold)"}}>{fmt(myTeam.purse)}</div>
            <div className="csl">💰 Purse Left</div>
            <div style={{background:"rgba(255,255,255,.08)",borderRadius:3,height:3,marginTop:6}}>
              <div style={{height:"100%",borderRadius:3,background:pctLeft<20?"var(--ng)":myTeam.color,width:`${pctLeft}%`,transition:"width .5s"}}/>
            </div>
          </div>
          <div className="cap-stat">
            <div className="csv" style={{color:"var(--cyan)"}}>{fmt(PURSE-myTeam.purse)}</div>
            <div className="csl">💸 Spent</div>
          </div>
          <div className="cap-stat">
            <div className="csv">{squad.length}/{MAX_SQUAD}</div>
            <div className="csl">🏏 Squad</div>
          </div>
          <div className="cap-stat">
            <div className="csv" style={{color:st.phase==="running"?"var(--ok)":"var(--mut)"}}>{st.aRound>0?`R${st.aRound}`:"—"}</div>
            <div className="csl">⚡ Round</div>
          </div>
        </div>

        {/* ALL OTHER TEAMS' PURSES */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:8,marginBottom:16}}>
          {allTeams.filter(t=>t.id!==myTeam.id).map(t=>{
            const pct=(t.purse/PURSE)*100;
            const isLead=t.id===st.curBidder;
            return(<div key={t.id} style={{flex:1,minWidth:120,background:isLead?`${t.color}15`:"rgba(34,30,50,.6)",
              border:`1px solid ${isLead?t.color:"rgba(255,255,255,.08)"}`,borderRadius:10,padding:"10px 12px",
              transition:"all .3s",boxShadow:isLead?`0 0 14px ${t.color}44`:"none"}}>
              <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
                <TeamLogo teamId={t.id} size={24}/>
                <div>
                  <div style={{fontFamily:"'Bebas Neue'",fontSize:13,color:t.color,letterSpacing:1}}>{t.short}</div>
                  {isLead&&<div style={{fontSize:8,color:"var(--ok)",letterSpacing:1}}>● BIDDING</div>}
                </div>
              </div>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:16,color:pct<20?"var(--ng)":"var(--gold)"}}>{fmt(t.purse)}</div>
              <div style={{background:"rgba(255,255,255,.08)",borderRadius:3,height:3,marginTop:4}}>
                <div style={{height:"100%",borderRadius:3,background:t.color,width:`${pct}%`,transition:"width .5s"}}/>
              </div>
              <div style={{fontSize:8,color:"var(--mut)",marginTop:3}}>{safeArr(t.squad).length}pl</div>
            </div>);
          })}
        </div>

        {/* MAIN BIDDING STAGE */}
        <div className={`bid-stage ${st.phase==="running"&&curPlayer?isLeading?"leading":"hot":""}`}>
          {(st.phase==="banner"||st.phase==="roundDone")&&<div className="nm">{st.phase==="roundDone"?`⏸️ Round ${st.aRound} done — admin starting Round ${st.aRound+1} shortly…`:"⏳ Waiting for admin to start the auction…"}</div>}
          {st.phase==="done"&&<div className="nm">🏆 Auction complete! Check your squad in the sidebar.</div>}
          {st.phase==="running"&&!curPlayer&&<div className="nm">Loading next player…</div>}
          {st.phase==="running"&&curPlayer&&(<>
            {/* Player on stage */}
            <div className="tt" style={{color:tc(curPlayer.tier),borderColor:`${tc(curPlayer.tier)}44`,border:"1px solid",
              display:"inline-flex",alignItems:"center",gap:5,padding:"4px 12px",borderRadius:20,
              marginBottom:10,fontSize:10,fontWeight:700,letterSpacing:1.5}}>
              {curPlayer.tier}
            </div>
            <div style={{width:72,height:72,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
              fontFamily:"'Bebas Neue'",fontSize:16,margin:"0 auto 8px",border:`3px solid ${tc(curPlayer.tier)}`,
              background:`${tc(curPlayer.tier)}15`,color:tc(curPlayer.tier),
              boxShadow:`0 0 20px ${tc(curPlayer.tier)}44`}}>
              {curPlayer.img}
            </div>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:30,letterSpacing:2,marginBottom:4,lineHeight:1.1}}>{curPlayer.name}</div>
            <div style={{display:"flex",justifyContent:"center",gap:7,flexWrap:"wrap",marginBottom:8}}>
              <span className="ch">{curPlayer.role}</span>
              <span className="ch">Base: {fmt(curPlayer.basePrice)}</span>
            </div>
            {(curPlayer.chUrl??"")&&(
              <a href={curPlayer.chUrl} target="_blank" rel="noopener noreferrer"
                style={{display:"inline-flex",alignItems:"center",gap:5,marginBottom:10,
                  padding:"5px 16px",background:"rgba(124,58,237,.12)",border:"1px solid rgba(139,92,246,.35)",
                  borderRadius:20,color:"#a78bfa",fontSize:10,fontWeight:700,textDecoration:"none",letterSpacing:.5}}>
                🏏 View on CricHeroes ↗
              </a>
            )}

            {/* Big bid display */}
            <div className="cur-bid-display">
              <div className="cbd-label">
                {isLeading&&st.firstBidder===myTeam.id&&st.curBidder===myTeam.id&&curBidSafe===curPlayer?.basePrice
                  ?"🎯 YOU ARE THE FIRST BIDDER"
                  :isLeading
                  ?"🔥 YOU ARE LEADING!"
                  :st.curBidder!==null
                  ?"⚡ SOMEONE IS LEADING"
                  :"🎯 OPENING PRICE — BID TO START"}
              </div>
              <div className={`cbd-amount ${isLeading?"leading-amount":""}`}>{fmt(st.curBidder!==null?Math.max(st.curBid,curPlayer?.basePrice??100):curPlayer?.basePrice??100)}</div>
              {!isLeading&&st.curBidder!==null&&leadTeam&&(
                <div className="cbd-leader" style={{background:`${leadTeam.color}22`,color:leadTeam.color}}>
                  ⚠ {leadTeam.name} has bid {fmt(curBidSafe)} pts — click BID {fmt(nextBid)} to outbid!
                </div>
              )}
              {isLeading&&(
                <div className="cbd-leader" style={{background:"rgba(0,255,136,.12)",color:"var(--ok)"}}>
                  {curBidSafe===curPlayer?.basePrice
                    ?`✓ You bid first at ${fmt(curPlayer?.basePrice??100)} pts — if others pass you win this player!`
                    :"✓ Your bid is highest — raise if needed if someone counter-bids!"}
                </div>
              )}
            </div>

            {/* BID BUTTON */}
            <div
              onClick={()=>{
                if(!canBidNow||isLeading)return;
                const cp2=safeArr(st.players).find((p:Player)=>p.id===safeArr(st.queue)[st.curIdx]);
                if(!cp2||st.phase!=="running")return;
                const safeCur2=st.curBidder!==null?Math.max(st.curBid,cp2.basePrice):0;
                const nb2=st.curBidder===null?cp2.basePrice:safeCur2+MIN_BID;
                const skipped2=safeArr(st.skippedTeams).filter((id:number)=>id!==myTeam.id);
                const fb2=st.firstBidder!==null?st.firstBidder:myTeam.id;
                const time2=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
                const log2=[{icon:"💰",text:`${myTeam.short} bid ${fmt(nb2)} for ${cp2.name}`,time:time2},...safeArr(st.log).slice(0,59)];
                update(ref(getDb(),"psAuction_v23"),{curBid:nb2,curBidder:myTeam.id,firstBidder:fb2,log:log2,skippedTeams:skipped2});
              }}
              style={{
                width:"100%",marginTop:14,padding:"18px 0",
                background:isLeading
                  ?"linear-gradient(135deg,#34d399,#059669)"
                  :canBidNow
                  ?"linear-gradient(135deg,#7c3aed,#4f46e5)"
                  :"rgba(255,255,255,.06)",
                borderRadius:13,
                color:canBidNow||isLeading?"#fff":"var(--mut)",
                fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:4,
                cursor:canBidNow&&!isLeading?"pointer":"default",
                textAlign:"center",
                border:canBidNow&&!isLeading?"2px solid rgba(255,255,255,.2)":"2px solid transparent",
                userSelect:"none",
                WebkitUserSelect:"none",
                touchAction:"manipulation",
                position:"relative",
                zIndex:20,
              }}>
              {isLeading
                ?`✓ LEADING ${fmt(curBidSafe)}`
                :canBidNow
                ?`🔨 BID ${fmt(nextBid)}`
                :"CANNOT BID"}
            </div>

            {/* PASS button */}
            {!isLeading&&st.phase==="running"&&!st.showSold&&(
              <div onClick={()=>{
                const cp4=safeArr(st.players).find((p:Player)=>p.id===safeArr(st.queue)[st.curIdx]);
                if(!cp4||st.phase!=="running")return;
                const skipped4=[...new Set([...safeArr(st.skippedTeams),myTeam.id])];
                const active4=safeArr(st.teams).filter((t:Team)=>
                  t.marqueeCount<MAX_MARQUEE&&
                  t.purse>=(st.curBidder===null?cp4.basePrice:Math.max(st.curBid,cp4.basePrice)+MIN_BID)&&
                  !skipped4.includes(t.id)&&t.id!==st.curBidder
                );
                const time4=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
                const log4=[{icon:"⏭️",text:`${myTeam.short} passed on ${cp4.name}`,time:time4},...safeArr(st.log).slice(0,59)];
                if(active4.length===0&&st.curBidder===null){
                  const log4b=[{icon:"❌",text:`${cp4.name} UNSOLD — all teams passed`,time:time4},...log4.slice(0,59)];
                  update(ref(getDb(),"psAuction_v23"),{log:log4b,skippedTeams:[],lastSold:null,firstBidder:null});
                } else {
                  update(ref(getDb(),"psAuction_v23"),{log:log4,skippedTeams:skipped4});
                }
              }}
                style={{width:"100%",marginTop:8,padding:"11px 0",background:"transparent",
                  border:`1px solid ${isSkipped?"rgba(251,146,60,.6)":"rgba(251,146,60,.25)"}`,
                  borderRadius:11,color:isSkipped?"var(--warn)":"rgba(251,146,60,.6)",
                  fontFamily:"'Bebas Neue'",fontSize:16,letterSpacing:3,cursor:"pointer",
                  textAlign:"center",touchAction:"manipulation",zIndex:20,position:"relative"}}>
                {isSkipped?"⏭ PASSED — WAIT FOR OTHERS":"⏭ PASS THIS PLAYER"}
              </div>
            )}
            {hasSkipped&&!isLeading&&(
              <div style={{fontSize:10,color:"rgba(251,146,60,.8)",marginTop:6,textAlign:"center",
                background:"rgba(251,146,60,.06)",border:"1px solid rgba(251,146,60,.15)",
                borderRadius:8,padding:"5px 10px"}}>
                You passed — you can still BID if another team bids first!
              </div>
            )}
            {!canBidNow&&!isLeading&&!isSkipped&&(
              <div style={{fontSize:11,color:"var(--mut)",marginTop:8,textAlign:"center",
                background:"rgba(255,255,255,.04)",borderRadius:8,padding:"7px 12px",lineHeight:1.6}}>
                {st.phase!=="running"
                  ?"⏳ Waiting for admin to start the auction"
                  :st.showSold
                  ?"⏳ Player just sold — next coming..."
                  :myTeam.marqueeCount>=MAX_MARQUEE
                  ?"✅ Squad full (8/8)"
                  :myTeam.marqueeCount>=MAX_MARQUEE
                  ?"✅ All 7 picks used"
                  :myTeam.purse<nextBid
                  ?"💰 Purse empty — tell admin which player you want"
                  :"⏳ Bidding paused — try refreshing"}
              </div>
            )}
          </>)}
        </div>
      </div>

      {/* SIDE PANEL: Squad */}
      <div className="cap-side">
        <div className="cap-side-sec">
          <div className="cap-side-title">🏆 My Squad ({squad.length}/{MAX_SQUAD})</div>
          {squad.length===0?<div style={{color:"var(--mut)",fontSize:11,padding:"8px 0"}}>No players yet</div>:
            squad.map(p=>(
              <div key={p.id} className="cap-squad-item">
                <div className="cap-sq-av" style={{borderColor:tc(p.tier),background:`${tc(p.tier)}15`,color:tc(p.tier)}}>{p.img.slice(0,2)}</div>
                <div className="cap-sq-info">
                  <div className="cap-sq-name">
                    {p.name}
                    {p.isCaptain&&<span className="cap-tag">©</span>}
                  </div>
                  <div className="cap-sq-role">{p.role}</div>
                </div>
                <div className="cap-sq-price">{p.isCaptain?"CAP":fmt(p.soldPrice)}</div>
              </div>
            ))}
        </div>
        <div className="cap-side-sec">
          <div className="cap-side-title">📊 Summary</div>
          <div style={{fontSize:11,color:"var(--mut)",lineHeight:2}}>
            <div>Budget Left: <span style={{color:"var(--gold)",fontWeight:700}}>{fmt(myTeam.purse)}</span></div>
            <div>Pts Spent: <span style={{color:"var(--cyan)",fontWeight:700}}>{fmt(PURSE-myTeam.purse)}</span></div>
            <div>Players: <span style={{color:"var(--txt)",fontWeight:700}}>{squad.length}/{MAX_SQUAD}</span></div>
            <div>Round: <span style={{color:"var(--warn)",fontWeight:700}}>{st.aRound>0?`R${st.aRound} of ${TOTAL_ROUNDS}`:"Not started"}</span></div>
          </div>
        </div>
        <div className="cap-side-sec">
          <div className="cap-side-title">📋 Recent Bids</div>
          <div style={{maxHeight:200,overflowY:"auto"}}>
            {safeArr(st.log).filter(l=>l.text.includes(myTeam.short)).slice(0,10).map((l,i)=>(
              <div key={i} style={{display:"flex",gap:7,padding:"5px 0",borderBottom:"1px solid rgba(255,255,255,.04)"}}>
                <span style={{fontSize:11}}>{l.icon}</span>
                <div><div style={{fontSize:10,lineHeight:1.4}}>{l.text}</div><div style={{fontSize:8,color:"var(--mut)"}}>{l.time}</div></div>
              </div>
            ))}
            {safeArr(st.log).filter(l=>l.text.includes(myTeam.short)).length===0&&<div style={{color:"var(--mut)",fontSize:10,padding:"4px 0"}}>No activity yet</div>}
          </div>
        </div>
      </div>
    </div>
  </div>);
}

// ─── VIEWER ───────────────────────────────────────────────────────────────────
function ViewerView({st,curPlayer,leadTeam,soldCount,onLogout}:{
  st:AuctionState;curPlayer:Player|undefined;leadTeam:Team|undefined;soldCount:number;onLogout:()=>void;
}){
  const [tab,setTab]=useState<"live"|"teams"|"players">("live");
  const teams=safeArr(st.teams); const players=safeArr(st.players);
  const auctionPlayers=players.filter(p=>!Object.values(CAPTAIN_MAP).includes(p.id));

  return(<div>
    <div className="hdr">
      <div className="hlw"><LogoParstriker size={36}/><div><div className="hl">PARSTRIKER AUCTION</div><div className="hl-sub">LIVE VIEWER</div></div></div>
      <div className="hr">
        <span className="rp" style={{background:"rgba(0,229,255,.1)",color:"var(--cyan)",borderColor:"rgba(0,229,255,.3)"}}>👁️ VIEWER</span>
        <button className="xb" onClick={onLogout}>Exit</button>
      </div>
    </div>
    {st.phase==="running"&&curPlayer&&(
      <div className="vtk">
        <span className="vld">LIVE</span>
        <span className="vtxt">
          On stage: <b style={{color:"var(--txt)"}}>{curPlayer.name}</b>
          {" · "}{curPlayer.role}
          {leadTeam&&<span> · <b style={{color:leadTeam.color}}>{leadTeam.name}</b> leading</span>}
          {""}
        </span>
      </div>
    )}
    <div className="nav">
      <button className={`nt ${tab==="live"?"on":""}`}    onClick={()=>setTab("live")}>📡 LIVE STAGE</button>
      <button className={`nt ${tab==="teams"?"on":""}`}   onClick={()=>setTab("teams")}>🏆 TEAM SQUADS</button>
      <button className={`nt ${tab==="players"?"on":""}`} onClick={()=>setTab("players")}>🏏 ALL PLAYERS</button>
    </div>

    {tab==="live"&&(<div style={{padding:"14px",maxWidth:480,margin:"0 auto"}}>
      {st.phase!=="running"?(
        <div style={{textAlign:"center",padding:"60px 20px",color:"var(--mut)"}}>
          <div style={{fontSize:44,marginBottom:14}}>{st.phase==="done"?"🏆":"⏳"}</div>
          <div style={{fontSize:14}}>{st.phase==="done"?"Parstriker Auction complete!":"Auction hasn't started yet."}</div>
        </div>
      ):curPlayer?(<>
        <div className="spl" style={{marginBottom:14}}>
          {/* Viewer sees player name + role only, NO bid amount */}
          <div style={{fontSize:11,color:"var(--cyan)",letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>NOW ON STAGE</div>
          <div style={{width:72,height:72,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
            fontFamily:"'Bebas Neue'",fontSize:16,margin:"0 auto 10px",border:`3px solid ${tc(curPlayer.tier)}`,
            background:`${tc(curPlayer.tier)}15`,color:tc(curPlayer.tier),boxShadow:`0 0 20px ${tc(curPlayer.tier)}33`}}>
            {curPlayer.img}
          </div>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:32,letterSpacing:3,marginBottom:6,lineHeight:1.1}}>{curPlayer.name}</div>
          <div style={{display:"flex",justifyContent:"center",gap:7,marginBottom:8,flexWrap:"wrap"}}>
            <span className="ch">{curPlayer.role}</span>
          </div>
          {(curPlayer.chUrl??"")&&(
            <a href={curPlayer.chUrl} target="_blank" rel="noopener noreferrer"
              style={{display:"inline-flex",alignItems:"center",gap:5,marginBottom:14,
                padding:"5px 16px",background:"rgba(124,58,237,.12)",border:"1px solid rgba(139,92,246,.35)",
                borderRadius:20,color:"var(--violet)",fontSize:10,fontWeight:700,
                textDecoration:"none",letterSpacing:.5}}>
              🏏 View on CricHeroes ↗
            </a>
          )}
          {/* NO bid amount — show bidding status only */}
          <div style={{background:"rgba(14,12,26,.85)",border:"1px solid rgba(124,58,237,.25)",borderRadius:11,padding:16}}>
            <div style={{fontSize:9,color:"var(--mut)",textTransform:"uppercase",letterSpacing:2,marginBottom:10}}>Bidding in Progress</div>
            {leadTeam?(
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12}}>
                <TeamLogo teamId={leadTeam.id} size={44}/>
                <div>
                  <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2,color:leadTeam.color}}>{leadTeam.name}</div>
                  <div style={{fontSize:10,color:"var(--mut)"}}>Currently Leading</div>
                </div>
              </div>
            ):<div style={{fontSize:12,color:"var(--mut)"}}>Waiting for bids…</div>}
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
          {teams.map(t=>(<div key={t.id} style={{background:"rgba(34,30,50,.7)",borderRadius:9,padding:"10px 7px",textAlign:"center",
            border:`1px solid ${t.id===leadTeam?.id?t.color:"rgba(255,255,255,.07)"}`,transition:"all .3s",
            boxShadow:t.id===leadTeam?.id?`0 0 12px ${t.color}44`:"none"}}>
            <TeamLogo teamId={t.id} size={32}/>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:11,color:t.color,letterSpacing:1,marginTop:4}}>{t.short}</div>
            <div style={{fontSize:8,color:"var(--mut)",marginTop:2}}>{safeArr(t.squad).length}pl</div>
          </div>))}
        </div>
      </>):null}
      <Footer/>
    </div>)}

    {tab==="teams"&&(<div>
      <div style={{padding:"12px 16px",maxWidth:960,margin:"0 auto"}}><div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2,marginBottom:12}}>Team Squads</div></div>
      <div className="tgrid">
        {teams.map(team=>{
          const squad=safeArr(team.squad);
          return(<div key={team.id} className="tfc">
            <div className="tfh" style={{borderBottom:`3px solid ${team.color}`}}>
              <div style={{position:"absolute",inset:0,background:`linear-gradient(135deg,${team.color}18,transparent)`,pointerEvents:"none"}}/>
              <TeamLogo teamId={team.id} size={44}/>
              <div style={{flex:1}}>
                <div className="tfn" style={{color:team.color}}>{team.name}</div>
                <div style={{fontSize:10,color:"var(--mut)"}}>{squad.length}/{MAX_SQUAD} players</div>
              </div>
            </div>
            <div className="tfl" style={{paddingTop:12}}>
              {squad.length===0&&<div style={{color:"var(--mut)",fontSize:11,padding:"6px 0"}}>No players yet</div>}
              {squad.map(p=>(<div key={p.id} className="tpr">
                <div className="tpa" style={{borderColor:tc(p.tier),background:`${tc(p.tier)}15`,color:tc(p.tier)}}>{p.img.slice(0,2)}</div>
                <div className="tpi">
                  <div className="tpn">{p.name}{p.isCaptain&&<span className="cap-tag">CAPTAIN</span>}</div>
                  <div className="tps">{p.role}</div>
                </div>
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
                  <div style={{fontSize:9,color:"var(--mut)",background:"rgba(20,17,35,.8)",padding:"2px 7px",borderRadius:4}}>
                    {p.isCaptain?"Captain":p.round===0?"Pre-set":`R${p.round}`}
                  </div>
                  {(p.chUrl??"")&&<a href={p.chUrl} target="_blank" rel="noopener noreferrer"
                    style={{fontSize:8,color:"var(--cyan)",textDecoration:"none",
                      background:"rgba(34,30,50,.9)",border:"1px solid rgba(124,58,237,.3)",
                      borderRadius:4,padding:"1px 5px",whiteSpace:"nowrap"}}>
                    🏏 CH
                  </a>}
                </div>
              </div>))}
            </div>
          </div>);
        })}
      </div>
      <Footer/>
    </div>)}

    {tab==="players"&&(<div className="pgw">
      <div style={{marginBottom:10}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2}}>All Players</div>
        <div style={{fontSize:11,color:"var(--mut)"}}>{soldCount} sold · {auctionPlayers.filter(p=>p.soldTo===null).length} available</div>
      </div>

      {/* ── CAPTAINS ── */}
      <div style={{marginBottom:18}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <div style={{fontFamily:"'Bebas Neue'",fontSize:14,letterSpacing:3,color:"var(--violet)"}}>👑 TEAM CAPTAINS</div>
          <div style={{flex:1,height:1,background:"linear-gradient(90deg,rgba(124,58,237,.4),transparent)"}}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(155px,1fr))",gap:8}}>
          {teams.map(team=>{
            const capId=CAPTAIN_MAP[team.id];
            const capPlayer=safeArr(players).find(p=>p.id===capId);
            if(!capPlayer) return null;
            return(
              <div key={team.id} style={{background:"linear-gradient(145deg,rgba(124,58,237,.1),rgba(79,70,229,.06))",
                border:"1px solid rgba(124,58,237,.3)",borderRadius:11,padding:12,position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:team.color}}/>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8,marginTop:4}}>
                  <TeamLogo teamId={team.id} size={24}/>
                  <div style={{fontSize:9,fontFamily:"'Bebas Neue'",letterSpacing:1,color:team.color}}>{team.short}</div>
                </div>
                <div style={{width:38,height:38,borderRadius:"50%",display:"flex",alignItems:"center",
                  justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:10,
                  border:`2px solid ${tc(capPlayer.tier)}`,background:`${tc(capPlayer.tier)}15`,
                  color:tc(capPlayer.tier),marginBottom:7}}>{capPlayer.img}</div>
                <div style={{fontFamily:"'Rajdhani'",fontWeight:700,fontSize:13,color:"#ffffff",marginBottom:2,lineHeight:1.2}}>{capPlayer.name}</div>
                <div style={{fontSize:9,color:"var(--mut)",marginBottom:5,lineHeight:1.3}}>{capPlayer.role}</div>
                <div style={{fontSize:8,color:"var(--violet)",background:"rgba(124,58,237,.1)",border:"1px solid rgba(124,58,237,.2)",borderRadius:8,padding:"2px 7px",display:"inline-block",marginBottom:6}}>👑 CAPTAIN</div>
                {(capPlayer.chUrl??"")&&<a href={capPlayer.chUrl} target="_blank" rel="noopener noreferrer" className="ch-link">🏏 CricHeroes ↗</a>}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── ALL PLAYERS ── */}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
        <div style={{fontFamily:"'Bebas Neue'",fontSize:14,letterSpacing:3,color:"var(--cyan)"}}>🏏 AUCTION PLAYERS</div>
        <div style={{flex:1,height:1,background:"linear-gradient(90deg,rgba(129,140,248,.4),transparent)"}}/>
      </div>
      <div className="pgg">
        {auctionPlayers.map(p=>{
          const sold=p.soldTo!==null?teams.find(t=>t.id===p.soldTo):undefined;
          return(<div key={p.id} className={`pc ${p.soldTo!==null?"sp":""}`}>
            <div className="pcav" style={{borderColor:tc(p.tier),background:`${tc(p.tier)}15`,color:tc(p.tier)}}>{p.img}</div>
            <div className="pcn">{p.name}</div>
            <div className="pcr">{p.role}</div>
            {sold?<div className="pcs">✓ {sold.name}</div>:<div className="pcb">Available</div>}
            {(p.chUrl??"")&&<a href={p.chUrl} target="_blank" rel="noopener noreferrer" className="ch-link">🏏 CricHeroes ↗</a>}
          </div>);
        })}
      </div>
      <Footer/>
    </div>)}
  </div>);
}

// ─── ADMIN TEAM CARDS ─────────────────────────────────────────────────────────
function AdminTeamCards({teams}:{teams:Team[]}){
  return(<>
    {teams.map(team=>{const squad=safeArr(team.squad);return(
      <div key={team.id} className="tfc">
        <div className="tfh" style={{borderBottom:`3px solid ${team.color}`}}>
          <div style={{position:"absolute",inset:0,background:`linear-gradient(135deg,${team.color}18,transparent)`,pointerEvents:"none"}}/>
          <TeamLogo teamId={team.id} size={44}/>
          <div style={{flex:1}}><div className="tfn" style={{color:team.color}}>{team.name}</div><div style={{fontSize:10,color:"var(--mut)"}}>Budget: {fmt(team.purse)}</div></div>
        </div>
        <div className="tfs">
          <div className="tv"><div className="tvv" style={{color:"var(--gold)"}}>{fmt(team.purse)}</div><div className="tvl">Left</div></div>
          <div className="tv"><div className="tvv">{squad.length}/{MAX_SQUAD}</div><div className="tvl">Players</div></div>
          <div className="tv"><div className="tvv">{fmt(PURSE-team.purse)}</div><div className="tvl">Spent</div></div>
        </div>
        <div className="tfl">
          {squad.length===0&&<div style={{color:"var(--mut)",fontSize:10,padding:"5px 0"}}>No players yet</div>}
          {squad.map(p=>(<div key={p.id} className="tpr">
            <div className="tpa" style={{borderColor:tc(p.tier),background:`${tc(p.tier)}15`,color:tc(p.tier)}}>{p.img.slice(0,2)}</div>
            <div className="tpi"><div className="tpn">{p.name}{p.isCaptain&&<span className="cap-tag">CAP</span>}</div><div className="tps">{p.role}{p.round===0?" · Pre-set":`· R${p.round}`}</div></div>
            <div className="tpp">{p.isCaptain?"—":fmt(p.soldPrice)}</div>
          </div>))}
        </div>
      </div>
    );})}
  </>);
}

// ─── DONE ─────────────────────────────────────────────────────────────────────
function DoneScreen({teams,players,rotatingPool}:{teams:Team[];players:Player[];rotatingPool:number[]}){
  const captainIds=Object.values(CAPTAIN_MAP);
  const poolPlayers=rotatingPool
    .map(id=>players.find(p=>p.id===id))
    .filter((p):p is Player=>!!p&&!captainIds.includes(p.id));

  return(
    <div>
      {/* ── AUCTION COMPLETE HERO ── */}
      <div className="done">
        <div className="dtr">🏆</div>
        <div className="dtl">PARSTRIKER AUCTION COMPLETE</div>
        <p style={{color:"var(--mut)",marginBottom:32}}>
          All squads locked · {poolPlayers.length} player{poolPlayers.length!==1?"s":""} in Rotating Pool
        </p>
      </div>

      {/* ── FINAL SQUADS ── */}
      <div className="tgrid"><AdminTeamCards teams={teams}/></div>

      {/* ── ROTATING PLAYER POOL ── */}
      {poolPlayers.length>0&&(
        <div style={{padding:"16px",maxWidth:960,margin:"0 auto"}}>
          {/* Header */}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,
            padding:"16px 20px",
            background:"linear-gradient(135deg,rgba(124,58,237,.12),rgba(56,189,248,.08))",
            border:"1px solid rgba(124,58,237,.3)",borderRadius:16}}>
            <div style={{fontSize:32}}>🔄</div>
            <div>
              <div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:3,
                background:"linear-gradient(90deg,#a78bfa,#38bdf8)",
                WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>
                ROTATING PLAYER POOL
              </div>
              <div style={{fontSize:12,color:"var(--mut)",marginTop:2,lineHeight:1.5}}>
                These {poolPlayers.length} players are available as substitutes on match day · 
                Any captain can request them based on availability
              </div>
            </div>
          </div>

          {/* Pool player cards */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:8}}>
            {poolPlayers.map(p=>(
              <div key={p.id} style={{
                background:"linear-gradient(145deg,rgba(34,30,50,.8),rgba(26,22,42,.9))",
                border:"1px solid rgba(124,58,237,.2)",borderRadius:11,padding:12,
                position:"relative",textAlign:"center"}}>
                {/* Rotating badge */}
                <div style={{position:"absolute",top:7,right:7,fontSize:9,
                  background:"rgba(56,189,248,.15)",border:"1px solid rgba(56,189,248,.3)",
                  color:"#38bdf8",borderRadius:6,padding:"1px 5px",fontWeight:700,letterSpacing:.5}}>
                  POOL
                </div>
                {/* Avatar */}
                <div style={{width:42,height:42,borderRadius:"50%",margin:"0 auto 8px",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontFamily:"'Bebas Neue'",fontSize:11,
                  border:`2px solid ${tc(p.tier)}`,
                  background:`${tc(p.tier)}15`,color:tc(p.tier)}}>
                  {p.img}
                </div>
                <div style={{fontFamily:"'Rajdhani'",fontWeight:700,fontSize:12,
                  color:"#ffffff",marginBottom:3,lineHeight:1.2}}>{p.name}</div>
                <div style={{fontSize:9,color:"var(--mut)",marginBottom:6,lineHeight:1.3}}>{p.role}</div>
                {p.chUrl&&(
                  <a href={p.chUrl} target="_blank" rel="noopener noreferrer"
                    style={{display:"block",fontSize:9,color:"var(--cyan)",textDecoration:"none",
                      background:"rgba(56,189,248,.08)",border:"1px solid rgba(56,189,248,.2)",
                      borderRadius:6,padding:"3px 0"}}>
                    🏏 CricHeroes
                  </a>
                )}
              </div>
            ))}
          </div>

          {/* Match day note */}
          <div style={{marginTop:16,padding:"12px 16px",
            background:"rgba(245,158,11,.06)",border:"1px solid rgba(245,158,11,.2)",
            borderRadius:12,display:"flex",gap:10,alignItems:"flex-start"}}>
            <div style={{fontSize:20,flexShrink:0}}>📋</div>
            <div>
              <div style={{fontFamily:"'Rajdhani'",fontWeight:700,fontSize:13,
                color:"var(--gold)",marginBottom:4,letterSpacing:.5}}>MATCH DAY RULES</div>
              <div style={{fontSize:11,color:"var(--mut)",lineHeight:1.8}}>
                • If a team player is unavailable, the captain can request a rotating pool player<br/>
                • Rotating players play for whichever team needs them that day<br/>
                • Priority given to teams with fewer available players<br/>
                • Admin confirms the substitute before the match begins
              </div>
            </div>
          </div>
        </div>
      )}
      <Footer/>
    </div>
  );
}

// ─── FOOTER ───────────────────────────────────────────────────────────────────
function Footer(){return(<div className="ps-footer"><div className="ps-footer-txt">© 2026 <span>vskplayz</span> · All Rights Reserved · <span style={{color:"rgba(139,92,246,.5)",fontSize:10}}>v1.1</span></div></div>);}
