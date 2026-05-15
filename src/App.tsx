// src/App.tsx
import { useState, useEffect, useCallback } from "react";
import { initializeApp, FirebaseApp } from "firebase/app";
import { getDatabase, Database, ref, onValue, set, update, get } from "firebase/database";

// ─── FIREBASE ─────────────────────────────────────────────────────────────────
interface FBConfig { apiKey:string; authDomain:string; databaseURL:string; projectId:string; storageBucket:string; messagingSenderId:string; appId:string; }
const FB_STORE_KEY = "ps_fb_config_v4";
const PREFILLED: Partial<FBConfig> = {
  apiKey:"AIzaSyD3k2c_0oX3C3f1nAqDRYidKYNCGJgF7I4",
  authDomain:"parstriker-auction.firebaseapp.com",
  databaseURL:"https://parstriker-auction-default-rtdb.firebaseio.com",
  projectId:"parstriker-auction",
  storageBucket:"parstriker-auction.firebasestorage.app",
  appId:"1:1400458016:web:b19f0b8d854f5a9df02545",
};
const loadCfg = (): FBConfig|null => { try { const r=localStorage.getItem(FB_STORE_KEY); return r?{...PREFILLED,...JSON.parse(r)} as FBConfig:null; } catch { return null; }};
const saveCfg = (c:FBConfig) => { try { localStorage.setItem(FB_STORE_KEY,JSON.stringify(c)); } catch {} };
let _app:FirebaseApp|null=null, _db:Database|null=null;
const initFB=(cfg:FBConfig):Database=>{ if(!_app){_app=initializeApp(cfg);_db=getDatabase(_app);} return _db!; };
const getDb=():Database=>{ if(_db)return _db; const c=loadCfg(); if(c)return initFB(c); throw new Error("FB not ready"); };
const fbRef=()=>ref(getDb(),"psAuction_v5");
const readSt=async():Promise<AuctionState>=>{ const s=await get(fbRef()); return s.exists()?s.val() as AuctionState:INIT_STATE; };
const writeSt=async(s:AuctionState)=>set(fbRef(),s);
const patchSt=async(p:Partial<AuctionState>)=>update(fbRef(),p);

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Role="login"|"admin"|"captain"|"viewer";
type Phase="banner"|"running"|"done";
interface Player { id:number; name:string; role:string; tier:string; country:string; img:string; basePrice:number; soldTo:number|null; soldPrice:number|null; round:number|null; }
interface SquadPlayer extends Player { soldPrice:number; isMarquee:boolean; round:number; }
interface Team { id:number; name:string; short:string; color:string; accent:string; captainPass:string; purse:number; squad:SquadPlayer[]; marqueeCount:number; }
interface LogItem { icon:string; text:string; time:string; }
interface AuctionState { queue:number[]; curIdx:number; curBid:number; curBidder:number|null; aRound:number; phase:Phase; showSold:boolean; aDone:boolean; log:LogItem[]; teams:Team[]; players:Player[]; dataVersion:number; }

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
// Budget math: 3 teams × 9 marquee players
// Price tiers: AR=100, Bat-AR=80, Bowl-AR=70, Bat=50, Bowl=50, WK=50
// Avg marquee cost ~70L × 9 = 630L per team budget needed
// Set purse = 800L so teams can bid high on top players or spread across cheap ones
const PURSE        = 800;
const MIN_BID      = 5;
const MAX_SQUAD    = 11;  // 11 players per team (cricket XI)
const MAX_MARQUEE  = 9;   // each team gets up to 9 marquee slots (all players are marquee here)
const TOTAL_ROUNDS = 3;
const ADMIN_PASS   = "admin123";
const DATA_VERSION = 5;
const safeArr=<T,>(a:T[]|null|undefined):T[]=>Array.isArray(a)?a:[];

// ─── PRICING TIERS ────────────────────────────────────────────────────────────
// All-Rounder > Batting AR > Bowling AR > Batsman = Bowler = WK
// Within each, some variation so budget strategy matters
const PLAYER_PRICES: Record<number, number> = {
  1:  70,   // Abdul Mubeen       All-Rounder
  2:  50,   // Amit Jadli         Bat/WK
  3:  45,   // Anshul Dikshit     Batsman
  4:  90,   // Ashish Negeet      All-Rounder (captain quality)
  5:  75,   // Janesh Chohan      All-Rounder
  6:  50,   // Jitendra Mistry    Batsman
  7: 100,   // Kannan Santharam   All-Rounder (captain quality)
  8:  55,   // Karthik Vempati    Batsman
  9:  80,   // Krunal Shah        All-Rounder
  10: 70,   // Mahendra Negi      All-Rounder
  11: 45,   // Nikhil Surabhi     Batsman
  12: 65,   // Pradeep Patil      Bowling AR
  13: 75,   // Pranay Raj         All-Rounder
  14: 70,   // Rajat Mehrotra     AR/WK
  15: 50,   // Sameer Saxena      Batsman
  16: 90,   // Sandeep Kirpane    All-Rounder (captain quality)
  17: 40,   // Sanjay Prajapati   Bowler
  18: 50,   // Sanket Rana        Batsman
  19: 60,   // Santosh Vaghmare   Bowling AR
  20: 45,   // Savan Paka         Batsman
  21: 40,   // Sushil Page        Batsman
  22: 45,   // Tushar More        Bowler
  23: 55,   // Vikramjeet         Bat/WK
  24: 65,   // Vineet Shende      All-Rounder
  25: 50,   // Srini Vellingiri   Batsman
  26: 60,   // Aravind Kaluva     Bowling AR
  27: 75,   // Raghav Ambati      Batting AR
  28: 60,   // Karan Shah         Bowling AR
  29: 55,   // Vibhor             Bat/WK
};

const RAW_PLAYERS = [
  { id:1,  name:"Abdul Mubeen",         role:"All-Rounder",         img:"AM"   },
  { id:2,  name:"Amit Jadli",           role:"Batsman / WK",        img:"AJ"   },
  { id:3,  name:"Anshul Dikshit",       role:"Batsman",             img:"AD"   },
  { id:4,  name:"Ashish Negeet",        role:"All-Rounder",         img:"AN"   },
  { id:5,  name:"Janesh Chohan",        role:"All-Rounder",         img:"JC"   },
  { id:6,  name:"Jitendra Mistry",      role:"Batsman",             img:"JM"   },
  { id:7,  name:"Kannan Santharam",     role:"All-Rounder",         img:"KS"   },
  { id:8,  name:"Karthik Vempati",      role:"Batsman",             img:"KV"   },
  { id:9,  name:"Krunal Shah",          role:"All-Rounder",         img:"KSh"  },
  { id:10, name:"Mahendra Negi",        role:"All-Rounder",         img:"MN"   },
  { id:11, name:"Nikhil Surabhi",       role:"Batsman",             img:"NS"   },
  { id:12, name:"Pradeep Patil",        role:"Bowling All-Rounder", img:"PP"   },
  { id:13, name:"Pranay Raj",           role:"All-Rounder",         img:"PR"   },
  { id:14, name:"Rajat Mehrotra",       role:"All-Rounder / WK",    img:"RM"   },
  { id:15, name:"Sameer Saxena",        role:"Batsman",             img:"SS"   },
  { id:16, name:"Sandeep Kirpane",      role:"All-Rounder",         img:"SK"   },
  { id:17, name:"Sanjay Prajapati",     role:"Bowler",              img:"SP"   },
  { id:18, name:"Sanket Rana",          role:"Batsman",             img:"SRa"  },
  { id:19, name:"Santosh Vaghmare",     role:"Bowling All-Rounder", img:"SV"   },
  { id:20, name:"Savan Paka",           role:"Batsman",             img:"SPa"  },
  { id:21, name:"Sushil Page",          role:"Batsman",             img:"SuP"  },
  { id:22, name:"Tushar More",          role:"Bowler",              img:"TM"   },
  { id:23, name:"Vikramjeet Sangavkar", role:"Batsman / WK",        img:"VS"   },
  { id:24, name:"Vineet Shende",        role:"All-Rounder",         img:"VSh"  },
  { id:25, name:"Srini Vellingiri",     role:"Batsman",             img:"SV2"  },
  { id:26, name:"Aravind Kaluva",       role:"Bowling All-Rounder", img:"AK"   },
  { id:27, name:"Raghav Ambati",        role:"Batting All-Rounder", img:"RA"   },
  { id:28, name:"Karan Shah",           role:"Bowling All-Rounder", img:"KSh2" },
  { id:29, name:"Vibhor",               role:"Batsman / WK",        img:"VB"   },
];

// Tier based on role for display
const roleTier=(role:string):string=>{
  if(role==="All-Rounder") return "Elite";
  if(role.includes("Batting All-Rounder")) return "Premium";
  if(role.includes("Bowling All-Rounder")) return "Premium";
  if(role.includes("WK")) return "Standard";
  if(role==="Batsman") return "Standard";
  return "Standard";
};

const INIT_PLAYERS: Player[] = RAW_PLAYERS.map(p=>({
  ...p, tier:roleTier(p.role), country:"IND",
  basePrice:PLAYER_PRICES[p.id]??40,
  soldTo:null, soldPrice:null, round:null,
}));

// ─── TEAMS ────────────────────────────────────────────────────────────────────
const INIT_TEAMS: Team[] = [
  { id:1, name:"Blue Indians",  short:"BI", color:"#1a56db", accent:"#FFD700", captainPass:"ashish123",  purse:PURSE, squad:[], marqueeCount:0 },
  { id:2, name:"Red Knights",   short:"RK", color:"#c41e3a", accent:"#FFD700", captainPass:"kannan123",  purse:PURSE, squad:[], marqueeCount:0 },
  { id:3, name:"White Wolves",  short:"WW", color:"#b0b8c8", accent:"#FFD700", captainPass:"sandeep123", purse:PURSE, squad:[], marqueeCount:0 },
];

const INIT_STATE: AuctionState = {
  queue:[], curIdx:0, curBid:0, curBidder:null,
  aRound:0, phase:"banner", showSold:false, aDone:false,
  log:[], teams:INIT_TEAMS, players:INIT_PLAYERS, dataVersion:DATA_VERSION,
};

// ─── UTILS ────────────────────────────────────────────────────────────────────
const fmt=(v:number):string=>v>=100?`₹${(v/100).toFixed(1)}Cr`:`₹${v}L`;
const tierColor=(t:string):string=>({Elite:"#FFD700",Premium:"#00e5ff",Standard:"#69ff47"}[t]??"#aaa");

// ─── SVG LOGOS ────────────────────────────────────────────────────────────────
// Parsippany Strikers main logo (cricket bat silhouette)
const LogoParstriker=({size=48}:{size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#0a1628" stroke="#c41e3a" strokeWidth="3"/>
    <circle cx="50" cy="42" r="22" fill="#c41e3a" opacity="0.85"/>
    {/* Batsman silhouette */}
    <ellipse cx="50" cy="36" rx="9" ry="10" fill="#1a56db"/>
    <rect x="44" y="46" width="12" height="18" rx="3" fill="#1a56db"/>
    {/* Bat */}
    <line x1="56" y1="50" x2="76" y2="28" stroke="#ffffff" strokeWidth="4" strokeLinecap="round"/>
    <rect x="72" y="23" width="6" height="10" rx="2" fill="#e8d5a0" transform="rotate(-45 72 23)"/>
    {/* Ball */}
    <circle cx="72" cy="52" r="5" fill="#ff4444" stroke="#fff" strokeWidth="1"/>
    <path d="M69 50 Q72 48 75 50" stroke="#fff" strokeWidth="1" fill="none"/>
    {/* Ground */}
    <ellipse cx="50" cy="88" rx="28" ry="5" fill="#1a56db" opacity="0.4"/>
    {/* Fielder silhouettes */}
    <circle cx="30" cy="78" r="4" fill="#0d1b2e"/>
    <rect x="27" y="82" width="6" height="10" rx="2" fill="#0d1b2e"/>
    <circle cx="70" cy="80" r="4" fill="#0d1b2e"/>
    <rect x="67" y="84" width="6" height="9" rx="2" fill="#0d1b2e"/>
  </svg>
);

// Blue Indians - Native American chief silhouette
const LogoBI=({size=48}:{size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#0d1b3e" stroke="#1a56db" strokeWidth="2.5"/>
    {/* Feathers */}
    <path d="M38 20 Q32 10 26 8 Q30 16 28 24" fill="#1a56db"/>
    <path d="M42 18 Q38 7 32 4 Q37 13 35 21" fill="#2a66eb"/>
    <path d="M46 17 Q44 6 38 2 Q44 11 42 19" fill="#1a56db"/>
    <path d="M50 16 Q50 5 44 1 Q51 10 49 18" fill="#2a66eb"/>
    <path d="M54 17 Q56 6 62 2 Q55 11 57 19" fill="#1a56db"/>
    {/* Face profile */}
    <path d="M58 30 Q62 28 64 34 Q66 42 62 52 Q58 60 52 64 Q46 68 42 64 Q36 58 36 48 Q36 36 42 30 Q48 24 58 30Z" fill="#1a56db"/>
    {/* Face details */}
    <path d="M56 38 Q60 38 60 42 Q60 46 58 48" stroke="#0d1b3e" strokeWidth="1.5" fill="none"/>
    <circle cx="57" cy="41" r="2.5" fill="#0d1b3e"/>
    <path d="M44 50 Q48 54 52 52" stroke="#0d1b3e" strokeWidth="1.5" fill="none"/>
    {/* Headband */}
    <path d="M36 38 Q50 34 64 38" stroke="#FFD700" strokeWidth="2.5" fill="none"/>
    {/* Neck / torso */}
    <path d="M44 64 Q40 72 38 82 Q50 85 62 82 Q60 72 56 64Z" fill="#1a56db"/>
  </svg>
);

// Red Knights - Knight helmet
const LogoRK=({size=48}:{size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#1a0008" stroke="#c41e3a" strokeWidth="2.5"/>
    {/* Plume feathers */}
    <path d="M50 12 Q42 8 36 14 Q40 16 38 22 Q44 16 50 18Z" fill="#c41e3a"/>
    <path d="M50 12 Q50 6 46 8 Q48 14 50 18Z" fill="#e03050"/>
    <path d="M50 12 Q58 8 64 14 Q60 16 62 22 Q56 16 50 18Z" fill="#c41e3a"/>
    {/* Helmet main */}
    <path d="M28 45 Q26 32 34 24 Q42 18 50 18 Q58 18 66 24 Q74 32 72 45 Q72 58 66 64 Q60 70 50 72 Q40 70 34 64 Q28 58 28 45Z" fill="#c41e3a"/>
    {/* Visor */}
    <path d="M30 46 Q34 42 50 42 Q66 42 70 46 Q68 54 50 56 Q32 54 30 46Z" fill="#8b1020"/>
    {/* Visor slits */}
    <rect x="34" y="44" width="14" height="3" rx="1.5" fill="#1a0008"/>
    <rect x="34" y="49" width="14" height="3" rx="1.5" fill="#1a0008"/>
    <rect x="52" y="44" width="14" height="3" rx="1.5" fill="#1a0008"/>
    <rect x="52" y="49" width="14" height="3" rx="1.5" fill="#1a0008"/>
    {/* Chin guard */}
    <path d="M36 64 Q38 74 50 76 Q62 74 64 64 Q58 68 50 68 Q42 68 36 64Z" fill="#c41e3a"/>
    {/* Highlight */}
    <path d="M36 30 Q40 24 50 22" stroke="#e87080" strokeWidth="2" fill="none" opacity="0.5"/>
  </svg>
);

// White Wolves - Wolf head
const LogoWW=({size=48}:{size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#12141a" stroke="#8090aa" strokeWidth="2.5"/>
    {/* Ears */}
    <path d="M28 36 Q24 20 32 16 Q36 26 34 34Z" fill="#b0b8c8"/>
    <path d="M30 30 Q28 22 33 18 Q35 25 33 30Z" fill="#6070a0"/>
    <path d="M72 36 Q76 20 68 16 Q64 26 66 34Z" fill="#b0b8c8"/>
    <path d="M70 30 Q72 22 67 18 Q65 25 67 30Z" fill="#6070a0"/>
    {/* Head */}
    <path d="M22 54 Q20 40 28 32 Q36 24 50 24 Q64 24 72 32 Q80 40 78 54 Q76 66 66 72 Q58 78 50 78 Q42 78 34 72 Q24 66 22 54Z" fill="#b0b8c8"/>
    {/* Snout */}
    <path d="M36 58 Q40 66 50 68 Q60 66 64 58 Q60 60 50 62 Q40 60 36 58Z" fill="#8090a8"/>
    <path d="M42 58 Q50 64 58 58 Q54 56 50 57 Q46 56 42 58Z" fill="#d0d8e8"/>
    {/* Nose */}
    <path d="M44 54 Q50 52 56 54 Q52 58 50 57 Q48 58 44 54Z" fill="#2a2e3a"/>
    {/* Eyes */}
    <ellipse cx="38" cy="46" rx="6" ry="5" fill="#e8e0f0"/>
    <circle cx="39" cy="46" r="3.5" fill="#4060c0"/>
    <circle cx="40" cy="45" r="1.5" fill="#0a0a14"/>
    <circle cx="41" cy="44" r="1" fill="#ffffff" opacity="0.7"/>
    <ellipse cx="62" cy="46" rx="6" ry="5" fill="#e8e0f0"/>
    <circle cx="61" cy="46" r="3.5" fill="#4060c0"/>
    <circle cx="62" cy="45" r="1.5" fill="#0a0a14"/>
    <circle cx="63" cy="44" r="1" fill="#ffffff" opacity="0.7"/>
    {/* Fur details */}
    <path d="M30 42 Q32 38 30 35" stroke="#8090a8" strokeWidth="1.5" fill="none"/>
    <path d="M70 42 Q68 38 70 35" stroke="#8090a8" strokeWidth="1.5" fill="none"/>
    <path d="M42 34 Q44 30 46 32" stroke="#8090a8" strokeWidth="1" fill="none"/>
    <path d="M54 32 Q56 28 58 30" stroke="#8090a8" strokeWidth="1" fill="none"/>
  </svg>
);

const TEAM_LOGOS: Record<number, (p:{size?:number})=>JSX.Element> = { 1:LogoBI, 2:LogoRK, 3:LogoWW };
const getTeamLogo=(id:number,size=40)=>{ const L=TEAM_LOGOS[id]; return L?<L size={size}/>:<div style={{width:size,height:size,borderRadius:"50%",background:"#333"}}/>; };

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@500;700&family=DM+Sans:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#05050e;--s1:#0c0c1a;--s2:#12121f;--s3:#1a1a2e;--bd:#25253d;
  --gold:#FFD700;--cyan:#00e5ff;--green:#69ff47;--txt:#f0f0ff;--mut:#5555aa;
  --ok:#00ff88;--ng:#ff3355;--warn:#ff9900;
}
body{background:var(--bg);color:var(--txt);font-family:'DM Sans',sans-serif;min-height:100vh;overflow-x:hidden}

/* SETUP */
.setup-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;
  background:radial-gradient(ellipse at 20% 20%,rgba(0,229,255,.08),transparent 50%),
             radial-gradient(ellipse at 80% 80%,rgba(255,215,0,.07),transparent 50%),var(--bg)}
.setup-box{background:linear-gradient(145deg,#0f0f22,#0a0a18);border:1px solid rgba(0,229,255,.3);
  border-radius:20px;padding:32px 28px;width:100%;max-width:460px;
  box-shadow:0 0 40px rgba(0,229,255,.1)}
.setup-logo-wrap{display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:6px}
.setup-logo-text{font-family:'Bebas Neue';font-size:32px;letter-spacing:4px;
  background:linear-gradient(90deg,#FFD700,#00e5ff);-webkit-background-clip:text;
  -webkit-text-fill-color:transparent;background-clip:text}
.setup-sub{font-family:'Bebas Neue';font-size:13px;letter-spacing:4px;color:var(--mut);
  text-align:center;margin-bottom:20px}
.setup-desc{font-size:11px;color:var(--mut);line-height:1.7;margin-bottom:18px;
  background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.12);border-radius:10px;padding:12px 14px}
.setup-desc b{color:var(--cyan)}
.setup-prefill{background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.12);
  border-radius:12px;padding:14px 16px;margin-bottom:18px}
.setup-prefill-title{font-size:9px;color:var(--cyan);text-transform:uppercase;letter-spacing:2px;font-weight:700;margin-bottom:10px}
.setup-prefill-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}
.setup-prefill-lbl{font-size:10px;color:var(--mut)}
.setup-prefill-val{font-size:10px;color:var(--txt);font-family:monospace;background:rgba(255,255,255,.06);padding:2px 7px;border-radius:4px}
.setup-field{margin-bottom:10px}
.setup-lbl{font-size:9px;color:var(--cyan);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:3px;display:block}
.setup-inp{width:100%;background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.2);
  border-radius:8px;padding:11px 12px;color:var(--txt);font-size:15px;outline:none;transition:all .2s;
  text-align:center;letter-spacing:2px}
.setup-inp:focus{border-color:var(--cyan);box-shadow:0 0 10px rgba(0,229,255,.15)}
.setup-err{background:rgba(255,51,85,.12);border:1px solid rgba(255,51,85,.4);border-radius:8px;
  padding:8px 12px;font-size:11px;color:var(--ng);margin-bottom:10px}
.setup-btn{width:100%;margin-top:14px;padding:14px;
  background:linear-gradient(135deg,var(--gold),var(--cyan));
  border:none;border-radius:11px;color:#000;font-family:'Bebas Neue';font-size:19px;
  letter-spacing:3px;cursor:pointer;transition:all .25s;font-weight:900}
.setup-btn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(255,215,0,.3)}

/* CONNECTING */
.conn{min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;background:var(--bg)}
.spin{width:44px;height:44px;border:3px solid rgba(0,229,255,.15);border-top-color:var(--cyan);border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* HEADER */
.hdr{background:linear-gradient(90deg,#05050e,#0a0520,#05050e);border-bottom:1px solid rgba(0,229,255,.15);
  padding:10px 18px;display:flex;align-items:center;justify-content:space-between;
  position:sticky;top:0;z-index:200;backdrop-filter:blur(20px)}
.hdr-logo-wrap{display:flex;align-items:center;gap:10px}
.hl{font-family:'Bebas Neue';font-size:20px;letter-spacing:3px;
  background:linear-gradient(90deg,var(--gold),var(--cyan));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.1}
.hl-sub{font-size:9px;color:var(--mut);letter-spacing:2px;font-family:'Rajdhani'}
.hr{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rp{padding:3px 11px;border-radius:20px;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border:1px solid}
.xb{background:transparent;border:1px solid var(--bd);color:var(--mut);padding:5px 12px;border-radius:7px;cursor:pointer;font-size:11px;transition:all .2s}
.xb:hover{border-color:var(--ng);color:var(--ng)}
.nb{background:transparent;border:1px solid var(--ng);color:var(--ng);padding:5px 12px;border-radius:7px;cursor:pointer;font-size:11px}

/* NAV */
.nav{background:rgba(0,0,0,.4);border-bottom:1px solid var(--bd);padding:0 18px;
  display:flex;gap:2px;overflow-x:auto;backdrop-filter:blur(10px)}
.nt{background:transparent;border:none;color:var(--mut);padding:12px 14px;cursor:pointer;
  font-family:'Rajdhani';font-weight:700;font-size:12px;letter-spacing:1px;
  border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap}
.nt:hover{color:var(--txt)}
.nt.on{color:var(--gold);border-bottom-color:var(--gold)}

/* LOGIN */
.lw{min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:16px;
  background:radial-gradient(ellipse at 25% 25%,rgba(255,215,0,.06),transparent 50%),
             radial-gradient(ellipse at 75% 75%,rgba(0,229,255,.06),transparent 50%),var(--bg)}
.login-hero{display:flex;flex-direction:column;align-items:center;margin-bottom:28px;gap:10px}
.login-hero-name{font-family:'Bebas Neue';font-size:14px;letter-spacing:4px;color:var(--mut);text-align:center}
.login-hero-title{font-family:'Bebas Neue';font-size:36px;letter-spacing:5px;text-align:center;
  background:linear-gradient(90deg,var(--gold),var(--cyan));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.login-hero-tagline{font-size:11px;color:var(--mut);letter-spacing:2px;text-align:center}
.lb{background:linear-gradient(145deg,#0f0f22,#0a0a18);border:1px solid rgba(255,215,0,.2);
  border-radius:22px;padding:32px 28px;width:100%;max-width:380px;
  box-shadow:0 0 50px rgba(255,215,0,.08)}
.ls{color:var(--mut);font-size:12px;margin-bottom:24px;letter-spacing:.5px;text-align:center}
.rg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}
.rb{background:rgba(255,255,255,.03);border:1px solid var(--bd);border-radius:12px;
  padding:14px 8px;cursor:pointer;transition:all .2s;color:var(--txt);text-align:center}
.rb:hover{border-color:rgba(255,215,0,.4);background:rgba(255,215,0,.04)}
.rb.sel{border-color:var(--gold);background:rgba(255,215,0,.07);box-shadow:0 0 12px rgba(255,215,0,.15)}
.ri{font-size:22px;margin-bottom:5px}
.rn{font-family:'Rajdhani';font-weight:700;font-size:13px;letter-spacing:1px;color:var(--gold)}
.rh{font-size:9px;color:var(--mut);margin-top:2px}
.inp{width:100%;background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.2);
  border-radius:9px;padding:11px 14px;color:var(--txt);font-size:13px;outline:none;
  transition:all .2s;margin-bottom:10px}
.inp:focus{border-color:var(--cyan);box-shadow:0 0 10px rgba(0,229,255,.12)}
.gb{width:100%;padding:14px;background:linear-gradient(135deg,var(--gold),#ff9900);
  border:none;border-radius:11px;color:#000;font-family:'Bebas Neue';font-size:19px;
  letter-spacing:3px;cursor:pointer;transition:all .2s;font-weight:900}
.gb:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(255,215,0,.35)}
.gb:disabled{opacity:.35;cursor:not-allowed;transform:none}
.em{color:var(--ng);font-size:11px;margin-bottom:8px;background:rgba(255,51,85,.1);
  border:1px solid rgba(255,51,85,.3);border-radius:7px;padding:7px 10px}
.ht{margin-top:12px;font-size:10px;color:var(--mut);line-height:1.8;text-align:center}

/* ROUND BANNER */
.rbn{text-align:center;padding:36px 24px;max-width:580px;margin:0 auto}
.rbe{font-family:'Rajdhani';font-size:11px;letter-spacing:4px;color:var(--mut);text-transform:uppercase;margin-bottom:8px}
.rbt{font-family:'Bebas Neue';font-size:52px;letter-spacing:5px;margin-bottom:10px;
  background:linear-gradient(90deg,var(--gold),var(--cyan));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.rbd{color:var(--mut);font-size:13px;margin-bottom:24px;line-height:1.7}
.rbb{padding:14px 40px;background:linear-gradient(135deg,var(--gold),#ff9900);
  border:none;border-radius:12px;color:#000;font-family:'Bebas Neue';font-size:21px;
  letter-spacing:3px;cursor:pointer;transition:all .25s;font-weight:900}
.rbb:hover{transform:translateY(-3px);box-shadow:0 10px 30px rgba(255,215,0,.4)}

/* TEAM CARDS */
.tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;padding:16px;max-width:960px;margin:0 auto}
.tfc{border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.08);
  background:linear-gradient(145deg,var(--s2),var(--s1));transition:all .3s}
.tfc:hover{transform:translateY(-3px)}
.tfh{padding:14px 16px;display:flex;align-items:center;gap:12px;position:relative;overflow:hidden}
.tfh-glow{position:absolute;inset:0;opacity:.1;pointer-events:none}
.tfn{font-family:'Bebas Neue';font-size:17px;letter-spacing:2px;flex:1}
.tfp{font-size:10px;color:var(--mut)}
.tfs{display:flex;gap:6px;padding:0 14px 12px}
.tv{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:7px;padding:7px 9px;flex:1;text-align:center}
.tvv{font-family:'Rajdhani';font-weight:700;font-size:15px}
.tvl{font-size:8px;color:var(--mut);text-transform:uppercase;letter-spacing:1px}
.tfl{padding:0 14px 14px}
.tpr{display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.tpr:last-child{border-bottom:none}
.tpa{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:7px;font-weight:700;border:1.5px solid;flex-shrink:0}
.tpi{flex:1}
.tpn{font-size:11px;font-weight:600}
.tps{font-size:9px;color:var(--mut)}
.tpp{font-family:'Rajdhani';font-weight:700;font-size:10px;color:var(--gold)}
.mq{font-size:7px;background:var(--gold);color:#000;padding:1px 3px;border-radius:2px;font-weight:700;letter-spacing:.5px;margin-left:3px}

/* AUCTION */
.al{display:grid;grid-template-columns:1fr 300px;min-height:calc(100vh - 108px)}
.stg{padding:18px;overflow-y:auto;background:radial-gradient(ellipse at 50% 0%,rgba(0,229,255,.05),transparent 60%),var(--bg)}
.st{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px}
.rpill{padding:4px 12px;border-radius:20px;font-family:'Rajdhani';font-weight:700;font-size:11px;
  letter-spacing:1px;background:rgba(255,215,0,.1);color:var(--gold);border:1px solid rgba(255,215,0,.3)}
.pb{background:rgba(255,255,255,.08);border-radius:4px;height:4px;width:140px;margin-top:4px}
.pf{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--gold),var(--cyan));transition:width .5s}
.spl{background:linear-gradient(145deg,rgba(0,229,255,.05),rgba(255,215,0,.03));
  border:1px solid rgba(0,229,255,.2);border-radius:20px;padding:24px;
  text-align:center;margin-bottom:14px;position:relative;overflow:hidden}
.spl::before{content:'';position:absolute;top:-40%;left:-20%;width:140%;height:140%;
  background:radial-gradient(ellipse,rgba(255,215,0,.04),transparent 55%);pointer-events:none}
.tt{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.05);
  border-radius:20px;padding:4px 12px;margin-bottom:12px;font-size:10px;font-weight:700;letter-spacing:1.5px;border:1px solid}
.pav{width:76px;height:76px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:'Bebas Neue';font-size:18px;margin:0 auto 10px;border:3px solid}
.pn{font-family:'Bebas Neue';font-size:32px;letter-spacing:3px;line-height:1;margin-bottom:8px}
.pm{display:flex;justify-content:center;gap:7px;margin-bottom:14px;flex-wrap:wrap}
.ch{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:3px 10px;font-size:11px;color:var(--txt)}
.bb{background:rgba(0,0,0,.4);border:1px solid rgba(255,215,0,.15);border-radius:12px;padding:14px;margin-bottom:14px}
.bl{font-size:9px;color:var(--mut);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:2px}
.ba{font-family:'Bebas Neue';font-size:44px;letter-spacing:2px;line-height:1;
  background:linear-gradient(90deg,var(--gold),#ff9900);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.bs{font-size:11px;color:var(--mut);margin-top:2px}
.bldr{font-family:'Rajdhani';font-size:13px;font-weight:700;margin-top:5px}
.bg{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:9px}
.tbb{padding:10px 7px;border-radius:10px;border:2px solid;cursor:pointer;font-family:'Rajdhani';font-weight:700;font-size:11px;transition:all .2s;text-align:left}
.tbb:disabled{opacity:.25;cursor:not-allowed}
.tbb:not(:disabled):hover{transform:translateY(-2px)}
.tdg{font-family:'Bebas Neue';font-size:11px;letter-spacing:1.5px;padding:2px 5px;border-radius:3px}
.ar{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.sdb{background:linear-gradient(135deg,var(--ok),#00cc66);border:none;border-radius:10px;color:#000;padding:12px;font-family:'Bebas Neue';font-size:18px;letter-spacing:2px;cursor:pointer;transition:all .2s;font-weight:900}
.sdb:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,255,136,.3)}
.sdb:disabled{opacity:.35;cursor:not-allowed}
.usb{background:transparent;border:2px solid var(--bd);border-radius:10px;color:var(--mut);padding:12px;font-family:'Bebas Neue';font-size:18px;letter-spacing:2px;cursor:pointer;transition:all .2s}
.usb:hover:not(:disabled){border-color:var(--ng);color:var(--ng)}
.usb:disabled{opacity:.35;cursor:not-allowed}
.so{position:absolute;inset:0;background:rgba(0,0,0,.9);display:flex;flex-direction:column;
  align-items:center;justify-content:center;border-radius:20px;z-index:10;animation:fi .3s ease}
.sot{font-family:'Bebas Neue';font-size:62px;letter-spacing:8px;color:var(--ok);animation:zi .4s ease;text-shadow:0 0 30px rgba(0,255,136,.5)}
.soto{font-size:14px;color:var(--mut);margin-top:3px}
.sop{font-family:'Bebas Neue';font-size:28px;background:linear-gradient(90deg,var(--gold),#ff9900);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes zi{from{transform:scale(.3) rotate(-5deg);opacity:0}to{transform:scale(1) rotate(0);opacity:1}}

/* SIDEBAR */
.sb{background:rgba(0,0,0,.5);border-left:1px solid var(--bd);overflow-y:auto;max-height:calc(100vh - 108px);backdrop-filter:blur(10px)}
.ss{padding:12px;border-bottom:1px solid var(--bd)}
.sbt{font-family:'Rajdhani';font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--mut);margin-bottom:10px}
.tc{background:rgba(255,255,255,.03);border-radius:9px;padding:10px;margin-bottom:6px;border:1px solid rgba(255,255,255,.06);transition:all .2s}
.tc.lead{border-color:var(--gold);box-shadow:0 0 12px rgba(255,215,0,.15)}
.tr{display:flex;justify-content:space-between;align-items:center}
.pbo{background:rgba(255,255,255,.08);border-radius:3px;height:3px;margin-top:5px}
.pbi{height:100%;border-radius:3px;transition:width .5s}
.sc{font-size:9px;color:var(--mut);margin-top:4px}
.ls{max-height:180px;overflow-y:auto}
.lr{display:flex;gap:7px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.li{font-size:11px;flex-shrink:0;margin-top:1px}
.lt{font-size:10px;line-height:1.4;flex:1}
.ltime{font-size:8px;color:var(--mut)}

/* CAPTAIN */
.cw{max-width:720px;margin:0 auto;padding:14px}
.cst{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
.cs{background:linear-gradient(145deg,var(--s2),var(--s1));border:1px solid var(--bd);border-radius:10px;padding:11px;text-align:center}
.csv{font-family:'Bebas Neue';font-size:22px;letter-spacing:1px}
.csl{font-size:8px;color:var(--mut);text-transform:uppercase;letter-spacing:1px;margin-top:2px}
.curb{background:linear-gradient(145deg,var(--s2),var(--s1));border:2px solid var(--bd);border-radius:16px;padding:20px;text-align:center;transition:all .3s}
.curb.act{border-color:rgba(255,215,0,.5);box-shadow:0 0 24px rgba(255,215,0,.1)}
.nm{color:var(--mut);font-size:13px;padding:44px 0}
.cbb{width:100%;margin-top:12px;padding:16px;border:none;border-radius:12px;color:#000;font-family:'Bebas Neue';font-size:21px;letter-spacing:3px;cursor:pointer;transition:all .25s;font-weight:900}
.cbb:hover:not(:disabled){transform:translateY(-3px)}
.cbb:disabled{opacity:.32;cursor:not-allowed}

/* PLAYERS */
.pgw{padding:14px;max-width:1000px;margin:0 auto}
.fr{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}
.fb{background:rgba(255,255,255,.04);border:1px solid var(--bd);color:var(--mut);padding:4px 11px;border-radius:14px;cursor:pointer;font-size:11px;transition:all .2s}
.fb.on,.fb:hover{border-color:var(--gold);color:var(--gold);background:rgba(255,215,0,.06)}
.pgg{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:8px}
.pc{background:linear-gradient(145deg,var(--s2),var(--s1));border:1px solid rgba(255,255,255,.07);border-radius:11px;padding:12px;transition:all .2s}
.pc:hover{border-color:rgba(255,215,0,.2);transform:translateY(-2px)}
.pc.sp{opacity:.5}
.pcav{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue';font-size:10px;border:2px solid;margin-bottom:7px}
.pcn{font-family:'Rajdhani';font-weight:700;font-size:12px;margin-bottom:2px;line-height:1.2}
.pcr{font-size:9px;color:var(--mut);margin-bottom:5px;line-height:1.3}
.pctb{font-size:8px;padding:2px 6px;border-radius:7px;background:rgba(255,255,255,.06);display:inline-block}
.pcs{font-size:9px;color:var(--ok);font-weight:700;margin-top:4px}
.pcb{font-size:9px;color:var(--mut);margin-top:3px}

/* VIEWER LIVE */
.vtk{padding:8px 16px;display:flex;align-items:center;gap:9px;overflow:hidden;background:rgba(0,229,255,.05);border-bottom:1px solid rgba(0,229,255,.15)}
.vld{background:var(--ng);color:#fff;font-size:8px;font-weight:700;padding:2px 5px;border-radius:3px;letter-spacing:1px;animation:pulse 1.5s infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.vtxt{font-size:11px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* VIEWER TEAM CARDS — no prices */
.vtfc{border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.08);background:linear-gradient(145deg,var(--s2),var(--s1))}
.vtfh{padding:14px 16px;display:flex;align-items:center;gap:12px;position:relative;overflow:hidden}
.vtfc-name{font-family:'Bebas Neue';font-size:17px;letter-spacing:2px;flex:1}
.vtfc-count{font-size:10px;color:var(--mut)}
.vtfc-players{padding:0 14px 14px}
.vtfc-player{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.vtfc-player:last-child{border-bottom:none}
.vtfc-pav{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:700;border:1.5px solid;flex-shrink:0}
.vtfc-pname{font-size:12px;font-weight:600;flex:1}
.vtfc-prole{font-size:9px;color:var(--mut)}

/* SQUAD */
.sqg{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.sqc{background:linear-gradient(145deg,var(--s2),var(--s1));border:1px solid rgba(255,255,255,.07);border-radius:11px;padding:12px}

/* DONE */
.done{text-align:center;padding:40px 20px}
.dtr{font-size:66px;animation:bou 1s infinite alternate}
@keyframes bou{from{transform:translateY(0)}to{transform:translateY(-10px)}}
.dtl{font-family:'Bebas Neue';font-size:44px;letter-spacing:5px;margin:12px 0 6px;
  background:linear-gradient(90deg,var(--gold),var(--cyan));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}

/* FOOTER */
.ps-footer{text-align:center;padding:18px 16px;border-top:1px solid rgba(255,215,0,.08);background:linear-gradient(0deg,rgba(255,215,0,.03),transparent)}
.ps-footer-txt{font-family:'Rajdhani';font-size:11px;letter-spacing:2px;color:rgba(255,215,0,.35);text-transform:uppercase}
.ps-footer-txt span{background:linear-gradient(90deg,var(--gold),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:700;letter-spacing:3px}

/* SYNC */
.sync-toast{position:fixed;bottom:12px;right:12px;background:rgba(0,229,255,.12);border:1px solid rgba(0,229,255,.3);border-radius:8px;padding:6px 12px;font-size:11px;color:var(--cyan);z-index:999;backdrop-filter:blur(10px)}

::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-track{background:var(--s1)}
::-webkit-scrollbar-thumb{background:var(--bd);border-radius:3px}

@media(max-width:680px){
  .al{grid-template-columns:1fr}
  .sb{max-height:220px;border-left:none;border-top:1px solid var(--bd)}
  .pn{font-size:24px}.ba{font-size:32px}
  .bg{grid-template-columns:repeat(3,1fr)}
  .cst{grid-template-columns:repeat(2,1fr)}
  .nt{padding:10px 9px;font-size:11px}
}
`;

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [fbReady,setFbReady] = useState<boolean>(()=>loadCfg()!==null);
  const [role,   setRole]    = useState<Role>("login");
  const [teamId, setTeamId]  = useState<number|null>(null);
  const [st,     setSt]      = useState<AuctionState>(INIT_STATE);
  const [loading,setLoading] = useState(true);
  const [saving, setSaving]  = useState(false);

  useEffect(()=>{
    if(!fbReady){setLoading(false);return;}
    let unsub:(()=>void)|null=null;
    try{
      unsub=onValue(fbRef(),snap=>{
        try{
          if(snap.exists()){
            const raw=snap.val() as AuctionState;
            if(!raw.dataVersion||raw.dataVersion<DATA_VERSION){
              writeSt(INIT_STATE).catch(()=>{});
              setSt(INIT_STATE);
            } else {
              setSt({
                ...INIT_STATE,...raw,
                queue:  safeArr(raw.queue),
                log:    safeArr(raw.log),
                teams:  safeArr(raw.teams).map(t=>({...t,squad:safeArr(t.squad)})),
                players:safeArr(raw.players),
              });
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
  const write=useCallback(async(next:AuctionState)=>{setSaving(true);try{await writeSt(next);}catch(e){console.error(e);}setSaving(false);},[]);
  const patch=useCallback(async(p:Partial<AuctionState>)=>{setSaving(true);try{await patchSt(p);}catch(e){console.error(e);}setSaving(false);},[]);

  const startRound=async(round:number)=>{
    const snap=await readSt();
    const sorted=[...safeArr(snap.players)].sort((a,b)=>b.basePrice-a.basePrice); // high price first
    const queue=round===1?sorted.map(p=>p.id):sorted.filter(p=>p.soldTo===null).map(p=>p.id);
    if(!queue.length){alert("No unsold players!");return;}
    const first=snap.players.find(p=>p.id===queue[0]);
    const log=addLog(snap,"🎙️",`Round ${round} started! ${queue.length} players.`);
    await write({...snap,queue,curIdx:0,curBid:first?.basePrice??20,curBidder:null,aRound:round,phase:"running",showSold:false,log});
  };

  const placeBid=async(tid:number)=>{
    const snap=await readSt();
    const cp=safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[snap.curIdx]);
    if(!cp||snap.phase!=="running")return;
    const team=safeArr(snap.teams).find(t=>t.id===tid);
    if(!team)return;
    const nb=snap.curBidder!==null?snap.curBid+MIN_BID:cp.basePrice;
    if(team.purse<nb)return;
    const log=addLog(snap,"💰",`${team.short} bid ${fmt(nb)} for ${cp.name}`);
    await patch({curBid:nb,curBidder:tid,log} as Partial<AuctionState>);
  };

  const doSold=async()=>{
    const snap=await readSt();
    if(snap.curBidder===null)return;
    const cp=safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[snap.curIdx]);
    if(!cp)return;
    const team=safeArr(snap.teams).find(t=>t.id===snap.curBidder);
    if(!team)return;
    const sp:SquadPlayer={...cp,soldPrice:snap.curBid,isMarquee:true,round:snap.aRound};
    const newTeams=safeArr(snap.teams).map(t=>t.id===snap.curBidder
      ?{...t,purse:t.purse-snap.curBid,squad:[...safeArr(t.squad),sp],marqueeCount:t.marqueeCount+1}:t);
    const newPlayers=safeArr(snap.players).map(p=>p.id===cp.id?{...p,soldTo:snap.curBidder,soldPrice:snap.curBid,round:snap.aRound}:p);
    const log=addLog(snap,"🔨",`SOLD! ${cp.name} → ${team.short} for ${fmt(snap.curBid)}`);
    await write({...snap,teams:newTeams,players:newPlayers,showSold:true,log});
    setTimeout(()=>advance(),2100);
  };

  const doUnsold=async()=>{
    const snap=await readSt();
    const cp=safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[snap.curIdx]);
    if(!cp)return;
    const log=addLog(snap,"❌",`${cp.name} UNSOLD (Round ${snap.aRound})`);
    await patch({log} as Partial<AuctionState>);
    advance();
  };

  const advance=async()=>{
    const snap=await readSt();
    const next=snap.curIdx+1;
    if(next>=safeArr(snap.queue).length){
      if(snap.aRound>=TOTAL_ROUNDS){
        const log=addLog(snap,"🏆","All rounds done! Parstriker Auction complete!");
        await write({...snap,showSold:false,aDone:true,phase:"done",log});
      } else {
        const log=addLog(snap,"🔔",`Round ${snap.aRound} complete! Unsold players re-enter.`);
        await write({...snap,showSold:false,phase:"banner",log});
      }
    } else {
      const np=safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[next]);
      await patch({curIdx:next,curBid:np?.basePrice??20,curBidder:null,showSold:false} as Partial<AuctionState>);
    }
  };

  const resetAll=async()=>{if(!confirm("Reset ALL data?"))return;await writeSt(INIT_STATE);};
  const logout=()=>{setRole("login");setTeamId(null);};
  const curPlayer=safeArr(st.queue).length>0?safeArr(st.players).find(p=>p.id===st.queue[st.curIdx]):undefined;
  const leadTeam=st.curBidder!==null?safeArr(st.teams).find(t=>t.id===st.curBidder):undefined;
  const soldCount=safeArr(st.players).filter(p=>p.soldTo!==null).length;
  const progPct=safeArr(st.queue).length>0?Math.round((st.curIdx/st.queue.length)*100):0;
  const myTeam=teamId!==null?safeArr(st.teams).find(t=>t.id===teamId):undefined;
  const canBid=useCallback((team:Team):boolean=>{
    if(st.showSold||!curPlayer||st.phase!=="running")return false;
    if(safeArr(team.squad).length>=MAX_SQUAD)return false;
    if(team.marqueeCount>=MAX_MARQUEE)return false;
    const nb=st.curBidder!==null?st.curBid+MIN_BID:curPlayer.basePrice;
    if(team.purse<nb)return false;
    if(team.id===st.curBidder)return false;
    return true;
  },[st,curPlayer]);

  if(!fbReady)return(<><style>{CSS}</style><FirebaseSetup onSave={cfg=>{saveCfg(cfg);initFB(cfg);setFbReady(true);setLoading(true);}}/></>);
  if(loading)return(<><style>{CSS}</style><div className="conn"><div className="spin"/><div style={{color:"var(--cyan)",fontSize:13,letterSpacing:1}}>Connecting to Parstriker…</div></div></>);

  return(<>
    <style>{CSS}</style>
    {saving&&<div className="sync-toast">⚡ Syncing…</div>}
    {role==="login"&&<LoginScreen teams={safeArr(st.teams)} onLogin={(r,tid)=>{setRole(r);if(tid!==undefined)setTeamId(tid);}}/>}
    {role==="admin"&&<AdminView st={st} curPlayer={curPlayer} leadTeam={leadTeam} soldCount={soldCount} progPct={progPct} onBid={placeBid} onSold={doSold} onUnsold={doUnsold} onStartRound={startRound} onLogout={logout} onReset={resetAll} canBid={canBid}/>}
    {role==="captain"&&myTeam&&<CaptainView myTeam={myTeam} st={st} curPlayer={curPlayer} onBid={placeBid} onLogout={logout} canBid={canBid(myTeam)}/>}
    {role==="viewer"&&<ViewerView st={st} curPlayer={curPlayer} leadTeam={leadTeam} soldCount={soldCount} onLogout={logout}/>}
  </>);
}

// ─── FIREBASE SETUP ───────────────────────────────────────────────────────────
function FirebaseSetup({onSave}:{onSave:(c:FBConfig)=>void}){
  const [sid,setSid]=useState("");
  const [err,setErr]=useState("");
  const save=()=>{
    setErr("");
    const id=sid.trim();
    if(!id){setErr("Please enter the Messaging Sender ID");return;}
    if(!/^\d+$/.test(id)){setErr("Numbers only");return;}
    onSave({...PREFILLED as FBConfig,messagingSenderId:id});
  };
  return(
    <div className="setup-wrap">
      <div className="setup-box">
        <div className="setup-logo-wrap">
          <LogoParstriker size={52}/>
          <div>
            <div className="setup-logo-text">PARSTRIKER</div>
            <div className="setup-sub" style={{textAlign:"left",marginBottom:0}}>AUCTION SETUP</div>
          </div>
        </div>
        <div style={{height:16}}/>
        <div className="setup-prefill">
          <div className="setup-prefill-title">✅ Pre-configured</div>
          {[["Project","parstriker-auction"],["Database","parstriker-auction-rtdb"],["API Key","AIzaSyD3k2•••F7I4"],["App ID","1:1400•••45"]].map(([l,v])=>(
            <div key={l} className="setup-prefill-row">
              <span className="setup-prefill-lbl">{l}</span>
              <span className="setup-prefill-val">{v}</span>
            </div>
          ))}
        </div>
        <div className="setup-desc">
          Enter your <b>Messaging Sender ID</b> to complete.<br/>
          Firebase Console → ⚙️ Project Settings → General → <b>Project number</b>
        </div>
        {err&&<div className="setup-err">⚠ {err}</div>}
        <div className="setup-field">
          <label className="setup-lbl">Messaging Sender ID</label>
          <input className="setup-inp" placeholder="e.g. 1400458016" value={sid}
            onChange={e=>setSid(e.target.value.trim())} onKeyDown={e=>e.key==="Enter"&&save()} autoFocus/>
        </div>
        <button className="setup-btn" onClick={save}>🔥 CONNECT &amp; LAUNCH</button>
        <div style={{marginTop:10,fontSize:10,color:"var(--mut)",textAlign:"center",lineHeight:1.7}}>Saved in browser · Enter once per device</div>
      </div>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({teams,onLogin}:{teams:Team[];onLogin:(r:Role,tid?:number)=>void}){
  const [sel,setSel]=useState<Role|null>(null);
  const [pass,setPass]=useState("");
  const [err,setErr]=useState("");
  const tryLogin=()=>{
    setErr("");
    if(!sel)return;
    if(sel==="viewer"){onLogin("viewer");return;}
    if(sel==="admin"){pass===ADMIN_PASS?onLogin("admin"):setErr("Wrong admin password");return;}
    const team=teams.find(t=>t.captainPass===pass);
    team?onLogin("captain",team.id):setErr("Wrong captain password");
  };
  return(
    <div className="lw">
      <div className="login-hero">
        <LogoParstriker size={80}/>
        <div className="login-hero-name">PARSIPPANY</div>
        <div className="login-hero-title">PARSTRIKER</div>
        <div className="login-hero-tagline">— UNLEASHING THE SPIRIT OF CRICKET —</div>
      </div>
      <div className="lb">
        <div className="ls">Select your role to enter the auction</div>
        <div className="rg">
          {([["admin","🎙️","Admin","Auction control"],["captain","👑","Captain","Bid players"],["viewer","👁️","Viewer","Watch live"]] as const).map(([r,ic,nm,hn])=>(
            <div key={r} className={`rb ${sel===r?"sel":""}`} onClick={()=>{setSel(r as Role);setPass("");setErr("");}}>
              <div className="ri">{ic}</div>
              <div className="rn">{nm}</div>
              <div className="rh">{hn}</div>
            </div>
          ))}
        </div>
        {err&&<div className="em">⚠ {err}</div>}
        {sel&&sel!=="viewer"&&(
          <input className="inp" type="password" placeholder={sel==="admin"?"Admin password":"Captain password"}
            value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&tryLogin()}/>
        )}
        {sel==="viewer"&&<div style={{fontSize:11,color:"var(--mut)",marginBottom:10,textAlign:"center"}}>No password required</div>}
        <button className="gb" disabled={!sel} onClick={tryLogin}>ENTER</button>
        <div className="ht">Contact the auction organiser for your password</div>
      </div>
      <Footer/>
    </div>
  );
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
function AdminView({st,curPlayer,leadTeam,soldCount,progPct,onBid,onSold,onUnsold,onStartRound,onLogout,onReset,canBid}:{
  st:AuctionState;curPlayer:Player|undefined;leadTeam:Team|undefined;
  soldCount:number;progPct:number;
  onBid:(id:number)=>void;onSold:()=>void;onUnsold:()=>void;
  onStartRound:(r:number)=>void;onLogout:()=>void;onReset:()=>void;
  canBid:(t:Team)=>boolean;
}){
  const [tab,setTab]=useState<"auction"|"players"|"teams">("auction");
  const [filter,setFilter]=useState("All");
  const teams=safeArr(st.teams);
  const players=safeArr(st.players);

  return(
    <div>
      <div className="hdr">
        <div className="hdr-logo-wrap">
          <LogoParstriker size={36}/>
          <div><div className="hl">PARSTRIKER AUCTION</div><div className="hl-sub">ADMIN CONTROL</div></div>
        </div>
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
        st.aDone?<DoneScreen teams={teams}/>:
        st.phase==="banner"?(
          <div>
            <div className="rbn">
              <div className="rbe">{st.aRound===0?"WELCOME TO":"ROUND "+st.aRound+" COMPLETE"}</div>
              <div className="rbt">{st.aRound===0?"PARSTRIKER AUCTION":`ROUND ${st.aRound+1} OF ${TOTAL_ROUNDS}`}</div>
              <div className="rbd">
                {st.aRound===0
                  ?`${players.length} players · ${TOTAL_ROUNDS} rounds · ${teams.length} teams · Purse ${fmt(PURSE)} each`
                  :`${players.filter(p=>p.soldTo===null).length} unsold players re-enter · Round ${st.aRound+1} of ${TOTAL_ROUNDS}`}
              </div>
              <button className="rbb" onClick={()=>onStartRound(st.aRound+1)}>
                {st.aRound===0?"⚡ START AUCTION":`▶ BEGIN ROUND ${st.aRound+1}`}
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
                  <div style={{fontSize:10,color:"var(--mut)"}}>Sold: {soldCount}/{players.length}</div>
                </div>
                <div>
                  <div style={{fontSize:9,color:"var(--mut)",marginBottom:3}}>Player {st.curIdx+1}/{safeArr(st.queue).length}</div>
                  <div className="pb"><div className="pf" style={{width:`${progPct}%`}}/></div>
                </div>
              </div>
              {curPlayer&&(
                <>
                  <div className="spl">
                    {st.showSold&&(
                      <div className="so">
                        <div className="sot">SOLD!</div>
                        <div className="soto">to {leadTeam?.name??""}</div>
                        <div className="sop">{fmt(st.curBid)}</div>
                      </div>
                    )}
                    <div className="tt" style={{color:tierColor(curPlayer.tier),borderColor:`${tierColor(curPlayer.tier)}44`}}>
                      {curPlayer.tier} · {curPlayer.role}
                    </div>
                    <div className="pav" style={{borderColor:tierColor(curPlayer.tier),background:`${tierColor(curPlayer.tier)}15`,color:tierColor(curPlayer.tier)}}>
                      {curPlayer.img}
                    </div>
                    <div className="pn">{curPlayer.name}</div>
                    <div className="pm">
                      <span className="ch">🏏 {curPlayer.role}</span>
                      <span className="ch">Base {fmt(curPlayer.basePrice)}</span>
                    </div>
                    <div className="bb">
                      <div className="bl">{st.curBidder!==null?"Current Bid":"Opening Price"}</div>
                      <div className="ba">{fmt(st.curBid)}</div>
                      <div className="bs">+{fmt(MIN_BID)} per raise</div>
                      {leadTeam&&<div className="bldr" style={{color:leadTeam.color}}>🔥 {leadTeam.name} leading</div>}
                    </div>
                  </div>
                  <div className="bg">
                    {teams.map(team=>{
                      const able=canBid(team),isLead=team.id===st.curBidder;
                      const nb=st.curBidder!==null?st.curBid+MIN_BID:curPlayer.basePrice;
                      return(
                        <button key={team.id} className="tbb" disabled={!able}
                          style={{borderColor:isLead?team.color:"var(--bd)",background:isLead?`${team.color}22`:"var(--s2)",color:isLead?team.color:"var(--txt)"}}
                          onClick={()=>onBid(team.id)}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                            {getTeamLogo(team.id,24)}
                            {able&&<span style={{fontSize:9,color:"var(--gold)",fontFamily:"'Bebas Neue'"}}>{fmt(nb)}</span>}
                          </div>
                          <div className="tdg" style={{background:`${team.color}22`,color:team.color}}>{team.short}</div>
                          <div style={{fontSize:8,opacity:.55,marginTop:2}}>{fmt(team.purse)}</div>
                          {isLead&&<div style={{fontSize:8,color:"var(--ok)",marginTop:1}}>● LEADING</div>}
                          {safeArr(team.squad).length>=MAX_SQUAD&&<div style={{fontSize:8,color:"var(--ng)",marginTop:1}}>FULL</div>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="ar">
                    <button className="sdb" disabled={st.curBidder===null||st.showSold} onClick={onSold}>🔨 SOLD</button>
                    <button className="usb" disabled={st.showSold} onClick={onUnsold}>❌ UNSOLD</button>
                  </div>
                </>
              )}
            </div>
            <div className="sb">
              <div className="ss">
                <div className="sbt">Team Purses</div>
                {teams.map(team=>{
                  const pct=(team.purse/PURSE)*100;
                  return(
                    <div key={team.id} className={`tc ${team.id===st.curBidder?"lead":""}`}>
                      <div className="tr">
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          {getTeamLogo(team.id,22)}
                          <span style={{fontSize:11,fontFamily:"'Rajdhani'",fontWeight:700}}>{team.short}</span>
                        </div>
                        <span style={{fontSize:10,fontWeight:600,color:pct<20?"var(--ng)":"var(--gold)"}}>{fmt(team.purse)}</span>
                      </div>
                      <div className="pbo"><div className="pbi" style={{width:`${pct}%`,background:pct<20?"var(--ng)":team.color}}/></div>
                      <div className="sc">Squad {safeArr(team.squad).length}/{MAX_SQUAD}</div>
                    </div>
                  );
                })}
              </div>
              <div className="ss">
                <div className="sbt">Bid Log</div>
                <div className="ls">
                  {safeArr(st.log).length===0&&<div style={{color:"var(--mut)",fontSize:10,padding:"3px 0"}}>No activity yet</div>}
                  {safeArr(st.log).map((l,i)=>(
                    <div key={i} className="lr">
                      <span className="li">{l.icon}</span>
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
          <div style={{marginBottom:10}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2}}>Player Pool</div>
            <div style={{fontSize:11,color:"var(--mut)"}}>{soldCount} sold · {players.length-soldCount} available</div>
          </div>
          <div className="fr">
            {["All","Available","Sold"].map(f=>(
              <button key={f} className={`fb ${filter===f?"on":""}`} onClick={()=>setFilter(f)}>{f}</button>
            ))}
          </div>
          <div className="pgg">
            {players.filter(p=>filter==="Available"?p.soldTo===null:filter==="Sold"?p.soldTo!==null:true).map(p=>{
              const sold=p.soldTo!==null?teams.find(t=>t.id===p.soldTo):undefined;
              return(
                <div key={p.id} className={`pc ${p.soldTo!==null?"sp":""}`}>
                  <div className="pcav" style={{borderColor:tierColor(p.tier),background:`${tierColor(p.tier)}15`,color:tierColor(p.tier)}}>{p.img}</div>
                  <div className="pcn">{p.name}</div>
                  <div className="pcr">{p.role}</div>
                  <div className="pctb" style={{color:tierColor(p.tier)}}>{p.tier}</div>
                  {sold?<div className="pcs">✓ {sold.short} · {fmt(p.soldPrice??0)} · R{p.round}</div>
                       :<div className="pcb">Base: {fmt(p.basePrice)}</div>}
                </div>
              );
            })}
          </div>
          <Footer/>
        </div>
      )}
      {tab==="teams"&&<div><div className="tgrid"><AdminTeamCards teams={teams}/></div><Footer/></div>}
    </div>
  );
}

// ─── CAPTAIN ──────────────────────────────────────────────────────────────────
function CaptainView({myTeam,st,curPlayer,onBid,onLogout,canBid}:{
  myTeam:Team;st:AuctionState;curPlayer:Player|undefined;
  onBid:(id:number)=>void;onLogout:()=>void;canBid:boolean;
}){
  const [tab,setTab]=useState<"bid"|"squad"|"log">("bid");
  const isLeading=st.curBidder===myTeam.id;
  const pctLeft=(myTeam.purse/PURSE)*100;
  const nextBid=st.curBidder!==null?st.curBid+MIN_BID:curPlayer?.basePrice??0;
  const myLogs=safeArr(st.log).filter(l=>l.text.includes(myTeam.short));
  const squad=safeArr(myTeam.squad);

  return(
    <div>
      <div className="hdr">
        <div className="hdr-logo-wrap">
          {getTeamLogo(myTeam.id,36)}
          <div><div className="hl" style={{fontSize:18}}>{myTeam.name}</div><div className="hl-sub">CAPTAIN DASHBOARD</div></div>
        </div>
        <div className="hr">
          <span className="rp" style={{background:`${myTeam.color}20`,color:myTeam.color,borderColor:`${myTeam.color}50`}}>👑 {myTeam.short}</span>
          <button className="xb" onClick={onLogout}>Logout</button>
        </div>
      </div>
      <div className="nav">
        <button className={`nt ${tab==="bid"?"on":""}`}   onClick={()=>setTab("bid")}>🔨 LIVE BID</button>
        <button className={`nt ${tab==="squad"?"on":""}`} onClick={()=>setTab("squad")}>🏏 MY SQUAD ({squad.length})</button>
        <button className={`nt ${tab==="log"?"on":""}`}   onClick={()=>setTab("log")}>📋 ACTIVITY ({myLogs.length})</button>
      </div>

      {tab==="bid"&&(
        <div className="cw">
          <div className="cst">
            <div className="cs"><div className="csv" style={{color:"var(--gold)"}}>{fmt(myTeam.purse)}</div><div className="csl">Purse Left</div>
              <div style={{background:"rgba(255,255,255,.08)",borderRadius:3,height:3,marginTop:5}}>
                <div style={{height:"100%",borderRadius:3,background:pctLeft<20?"var(--ng)":myTeam.color,width:`${pctLeft}%`,transition:"width .5s"}}/>
              </div>
            </div>
            <div className="cs"><div className="csv">{squad.length}/{MAX_SQUAD}</div><div className="csl">Squad</div></div>
            <div className="cs"><div className="csv">{myTeam.marqueeCount}/{MAX_MARQUEE}</div><div className="csl">Slots Used</div></div>
            <div className="cs"><div className="csv" style={{color:"var(--warn)"}}>{st.aRound>0?`R${st.aRound}`:"—"}</div><div className="csl">Round</div></div>
          </div>
          <div className={`curb ${st.phase==="running"&&curPlayer?"act":""}`}>
            {st.phase==="banner"&&<div className="nm">⏳ Waiting for admin to start…</div>}
            {st.phase==="done"&&<div className="nm">🏆 Auction complete! Check your squad.</div>}
            {st.phase==="running"&&!curPlayer&&<div className="nm">Loading next player…</div>}
            {st.phase==="running"&&curPlayer&&(
              <>
                <div className="tt" style={{color:tierColor(curPlayer.tier),borderColor:`${tierColor(curPlayer.tier)}44`,
                  border:"1px solid",display:"inline-flex",alignItems:"center",gap:5,
                  padding:"4px 12px",borderRadius:20,marginBottom:12,fontSize:10,fontWeight:700,letterSpacing:1.5}}>
                  {curPlayer.tier}
                </div>
                <div style={{width:70,height:70,borderRadius:"50%",display:"flex",alignItems:"center",
                  justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:16,margin:"0 auto 9px",
                  border:`3px solid ${tierColor(curPlayer.tier)}`,background:`${tierColor(curPlayer.tier)}15`,color:tierColor(curPlayer.tier)}}>
                  {curPlayer.img}
                </div>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:28,letterSpacing:2,marginBottom:7,lineHeight:1.1}}>{curPlayer.name}</div>
                <div style={{display:"flex",justifyContent:"center",gap:7,marginBottom:12,flexWrap:"wrap"}}>
                  <span className="ch">{curPlayer.role}</span>
                  <span className="ch">Base {fmt(curPlayer.basePrice)}</span>
                </div>
                <div style={{background:"rgba(0,0,0,.4)",border:"1px solid rgba(255,215,0,.15)",borderRadius:11,padding:13,marginBottom:4}}>
                  <div style={{fontSize:9,color:"var(--mut)",textTransform:"uppercase",letterSpacing:1.5,marginBottom:2}}>
                    {isLeading?"🔥 YOU ARE LEADING":st.curBidder!==null?"Bid in Progress":"Opening Price"}
                  </div>
                  <div style={{fontFamily:"'Bebas Neue'",fontSize:40,lineHeight:1,
                    background:isLeading?"linear-gradient(90deg,var(--ok),#00cc66)":"linear-gradient(90deg,var(--gold),#ff9900)",
                    WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>
                    {fmt(st.curBid)}
                  </div>
                  {!isLeading&&st.curBidder!==null&&<div style={{fontSize:11,color:"var(--ng)",marginTop:3}}>⚠ Another team is leading!</div>}
                </div>
                <button className="cbb"
                  style={{background:isLeading?"linear-gradient(135deg,var(--ok),#00cc66)":"linear-gradient(135deg,var(--gold),#ff9900)"}}
                  disabled={!canBid} onClick={()=>onBid(myTeam.id)}>
                  {isLeading?`✓ LEADING ${fmt(st.curBid)}`:canBid?`BID ${fmt(nextBid)}`:"CANNOT BID"}
                </button>
                {!canBid&&!isLeading&&(
                  <div style={{fontSize:10,color:"var(--mut)",marginTop:6}}>
                    {myTeam.purse<nextBid?"⚠ Insufficient purse":
                     squad.length>=MAX_SQUAD?"⚠ Squad full (11)":
                     myTeam.marqueeCount>=MAX_MARQUEE?"⚠ All 9 slots used":"Bidding paused"}
                  </div>
                )}
              </>
            )}
          </div>
          <Footer/>
        </div>
      )}
      {tab==="squad"&&(
        <div className="cw">
          <div style={{marginBottom:12}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2}}>{myTeam.name} Squad</div>
            <div style={{fontSize:11,color:"var(--mut)"}}>{squad.length} players · Spent: {fmt(PURSE-myTeam.purse)} · Remaining: {fmt(myTeam.purse)}</div>
          </div>
          {squad.length===0?<div style={{color:"var(--mut)",textAlign:"center",padding:"50px 0"}}>No players yet</div>:(
            <div className="sqg">
              {squad.map(p=>(
                <div key={p.id} className="sqc">
                  <div style={{width:38,height:38,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                    fontFamily:"'Bebas Neue'",fontSize:9,border:`2px solid ${tierColor(p.tier)}`,
                    background:`${tierColor(p.tier)}15`,color:tierColor(p.tier),marginBottom:7}}>{p.img}</div>
                  <div style={{fontFamily:"'Rajdhani'",fontWeight:700,fontSize:12,marginBottom:2,lineHeight:1.2}}>{p.name}</div>
                  <div style={{fontSize:9,color:"var(--mut)",marginBottom:4,lineHeight:1.3}}>{p.role}</div>
                  <div style={{fontFamily:"'Rajdhani'",fontWeight:700,fontSize:12,color:"var(--gold)"}}>{fmt(p.soldPrice)} · R{p.round}</div>
                </div>
              ))}
            </div>
          )}
          <Footer/>
        </div>
      )}
      {tab==="log"&&(
        <div className="cw">
          <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2,marginBottom:12}}>My Activity</div>
          {myLogs.length===0?<div style={{color:"var(--mut)",textAlign:"center",padding:"50px 0"}}>No activity yet</div>:
            myLogs.map((l,i)=>(
              <div key={i} style={{display:"flex",gap:9,padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,.05)"}}>
                <span style={{fontSize:16}}>{l.icon}</span>
                <div><div style={{fontSize:12}}>{l.text}</div><div style={{fontSize:9,color:"var(--mut)"}}>{l.time}</div></div>
              </div>
            ))}
          <Footer/>
        </div>
      )}
    </div>
  );
}

// ─── VIEWER ───────────────────────────────────────────────────────────────────
function ViewerView({st,curPlayer,leadTeam,soldCount,onLogout}:{
  st:AuctionState;curPlayer:Player|undefined;leadTeam:Team|undefined;soldCount:number;onLogout:()=>void;
}){
  const [tab,setTab]=useState<"live"|"teams"|"players">("live");
  const teams=safeArr(st.teams);
  const players=safeArr(st.players);

  return(
    <div>
      <div className="hdr">
        <div className="hdr-logo-wrap">
          <LogoParstriker size={36}/>
          <div><div className="hl">PARSTRIKER AUCTION</div><div className="hl-sub">LIVE VIEWER</div></div>
        </div>
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
            {" · "}Round {st.aRound}/{TOTAL_ROUNDS} · {soldCount}/{players.length} sold
          </span>
        </div>
      )}
      <div className="nav">
        <button className={`nt ${tab==="live"?"on":""}`}    onClick={()=>setTab("live")}>📡 LIVE STAGE</button>
        <button className={`nt ${tab==="teams"?"on":""}`}   onClick={()=>setTab("teams")}>🏆 TEAM SQUADS</button>
        <button className={`nt ${tab==="players"?"on":""}`} onClick={()=>setTab("players")}>🏏 ALL PLAYERS</button>
      </div>

      {tab==="live"&&(
        <div style={{padding:"14px",maxWidth:480,margin:"0 auto"}}>
          {st.phase!=="running"?(
            <div style={{textAlign:"center",padding:"60px 20px",color:"var(--mut)"}}>
              <div style={{fontSize:44,marginBottom:14}}>{st.phase==="done"?"🏆":"⏳"}</div>
              <div style={{fontSize:14}}>{st.phase==="done"?"Parstriker Auction complete!":"Auction hasn't started yet."}</div>
            </div>
          ):curPlayer?(
            <>
              <div className="spl" style={{marginBottom:14}}>
                <div className="tt" style={{color:tierColor(curPlayer.tier),borderColor:`${tierColor(curPlayer.tier)}44`,
                  border:"1px solid",display:"inline-flex",gap:5,padding:"4px 12px",borderRadius:20,marginBottom:12,fontSize:10,fontWeight:700,letterSpacing:1.5}}>
                  {curPlayer.tier} · {curPlayer.role}
                </div>
                <div style={{width:72,height:72,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                  fontFamily:"'Bebas Neue'",fontSize:16,margin:"0 auto 9px",border:`3px solid ${tierColor(curPlayer.tier)}`,
                  background:`${tierColor(curPlayer.tier)}15`,color:tierColor(curPlayer.tier)}}>
                  {curPlayer.img}
                </div>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:30,letterSpacing:3,marginBottom:7,lineHeight:1.1}}>{curPlayer.name}</div>
                <div style={{display:"flex",justifyContent:"center",gap:7,marginBottom:14,flexWrap:"wrap"}}>
                  <span className="ch">{curPlayer.role}</span>
                </div>
                {/* Viewer DOES NOT see bid amount - only who is leading */}
                <div style={{background:"rgba(0,0,0,.4)",border:"1px solid rgba(0,229,255,.15)",borderRadius:11,padding:14}}>
                  <div style={{fontSize:9,color:"var(--mut)",textTransform:"uppercase",letterSpacing:1.5,marginBottom:6}}>Bidding in Progress</div>
                  {leadTeam?(
                    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
                      {getTeamLogo(leadTeam.id,40)}
                      <div>
                        <div style={{fontFamily:"'Bebas Neue'",fontSize:22,letterSpacing:2,color:leadTeam.color}}>
                          {leadTeam.name}
                        </div>
                        <div style={{fontSize:10,color:"var(--mut)"}}>Currently Leading</div>
                      </div>
                    </div>
                  ):(
                    <div style={{fontSize:12,color:"var(--mut)"}}>Waiting for first bid…</div>
                  )}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
                {teams.map(t=>(
                  <div key={t.id} style={{background:"rgba(255,255,255,.04)",borderRadius:9,padding:"10px 7px",textAlign:"center",
                    border:`1px solid ${t.id===leadTeam?.id?t.color:"rgba(255,255,255,.07)"}`,transition:"all .3s",
                    boxShadow:t.id===leadTeam?.id?`0 0 12px ${t.color}44`:"none"}}>
                    {getTeamLogo(t.id,32)}
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:11,color:t.color,letterSpacing:1,marginTop:4}}>{t.short}</div>
                    <div style={{fontSize:8,color:"var(--mut)",marginTop:2}}>{safeArr(t.squad).length}pl</div>
                  </div>
                ))}
              </div>
            </>
          ):null}
          <Footer/>
        </div>
      )}

      {tab==="teams"&&(
        <div>
          <div style={{padding:"14px 16px",maxWidth:960,margin:"0 auto"}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2,marginBottom:14}}>Team Squads</div>
          </div>
          {/* Viewer team cards — NO prices shown */}
          <div className="tgrid">
            {teams.map(team=>{
              const squad=safeArr(team.squad);
              return(
                <div key={team.id} className="vtfc">
                  <div className="vtfh" style={{borderBottom:`3px solid ${team.color}`}}>
                    <div style={{position:"absolute",inset:0,background:`linear-gradient(135deg,${team.color}18,transparent)`,pointerEvents:"none"}}/>
                    {getTeamLogo(team.id,44)}
                    <div style={{flex:1}}>
                      <div className="vtfc-name" style={{color:team.color}}>{team.name}</div>
                      <div className="vtfc-count">{squad.length}/{MAX_SQUAD} players</div>
                    </div>
                  </div>
                  <div className="vtfc-players">
                    {squad.length===0&&<div style={{color:"var(--mut)",fontSize:11,padding:"8px 0"}}>No players yet</div>}
                    {squad.map(p=>(
                      <div key={p.id} className="vtfc-player">
                        <div className="vtfc-pav" style={{borderColor:tierColor(p.tier),background:`${tierColor(p.tier)}15`,color:tierColor(p.tier)}}>
                          {p.img.slice(0,2)}
                        </div>
                        <div style={{flex:1}}>
                          <div className="vtfc-pname">{p.name}</div>
                          <div className="vtfc-prole">{p.role}</div>
                        </div>
                        {/* NO price shown to viewer */}
                        <div style={{fontSize:9,color:"var(--mut)",background:"rgba(255,255,255,.05)",padding:"2px 7px",borderRadius:4}}>
                          R{p.round}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <Footer/>
        </div>
      )}

      {tab==="players"&&(
        <div className="pgw">
          <div style={{marginBottom:10}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2}}>All Players</div>
            <div style={{fontSize:11,color:"var(--mut)"}}>{soldCount} sold · {players.length-soldCount} available</div>
          </div>
          <div className="pgg">
            {players.map(p=>{
              const sold=p.soldTo!==null?teams.find(t=>t.id===p.soldTo):undefined;
              return(
                <div key={p.id} className={`pc ${p.soldTo!==null?"sp":""}`}>
                  <div className="pcav" style={{borderColor:tierColor(p.tier),background:`${tierColor(p.tier)}15`,color:tierColor(p.tier)}}>{p.img}</div>
                  <div className="pcn">{p.name}</div>
                  <div className="pcr">{p.role}</div>
                  <div className="pctb" style={{color:tierColor(p.tier)}}>{p.tier}</div>
                  {/* Viewer sees team name only, NO price */}
                  {sold?<div className="pcs">✓ {sold.name}</div>:<div className="pcb">Available</div>}
                </div>
              );
            })}
          </div>
          <Footer/>
        </div>
      )}
    </div>
  );
}

// ─── ADMIN TEAM CARDS (with prices) ──────────────────────────────────────────
function AdminTeamCards({teams}:{teams:Team[]}){
  return(
    <>
      {teams.map(team=>{
        const squad=safeArr(team.squad);
        return(
          <div key={team.id} className="tfc">
            <div className="tfh" style={{borderBottom:`3px solid ${team.color}`}}>
              <div className="tfh-glow" style={{background:`linear-gradient(135deg,${team.color},transparent)`}}/>
              {getTeamLogo(team.id,44)}
              <div style={{flex:1}}>
                <div className="tfn" style={{color:team.color}}>{team.name}</div>
                <div className="tfp">Purse: {fmt(team.purse)}</div>
              </div>
            </div>
            <div className="tfs">
              <div className="tv"><div className="tvv" style={{color:"var(--gold)"}}>{fmt(team.purse)}</div><div className="tvl">Left</div></div>
              <div className="tv"><div className="tvv">{squad.length}/{MAX_SQUAD}</div><div className="tvl">Players</div></div>
              <div className="tv"><div className="tvv">{fmt(PURSE-team.purse)}</div><div className="tvl">Spent</div></div>
            </div>
            <div className="tfl">
              {squad.length===0&&<div style={{color:"var(--mut)",fontSize:10,padding:"5px 0"}}>No players yet</div>}
              {squad.map(p=>(
                <div key={p.id} className="tpr">
                  <div className="tpa" style={{borderColor:tierColor(p.tier),background:`${tierColor(p.tier)}15`,color:tierColor(p.tier)}}>{p.img.slice(0,2)}</div>
                  <div className="tpi"><div className="tpn">{p.name}</div><div className="tps">{p.role} · R{p.round}</div></div>
                  <div className="tpp">{fmt(p.soldPrice)}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ─── DONE ─────────────────────────────────────────────────────────────────────
function DoneScreen({teams}:{teams:Team[]}){
  return(
    <div>
      <div className="done">
        <div className="dtr">🏆</div>
        <div className="dtl">PARSTRIKER AUCTION COMPLETE</div>
        <p style={{color:"var(--mut)",marginBottom:32}}>All {TOTAL_ROUNDS} rounds done · Final squads locked!</p>
      </div>
      <div className="tgrid"><AdminTeamCards teams={teams}/></div>
      <Footer/>
    </div>
  );
}

// ─── FOOTER ───────────────────────────────────────────────────────────────────
function Footer(){
  return(
    <div className="ps-footer">
      <div className="ps-footer-txt">© 2025 <span>SKIRPANE</span> · All Rights Reserved</div>
    </div>
  );
}
