// src/App.tsx
import { useState, useEffect, useCallback, useRef } from "react";
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
const loadCfg=():FBConfig|null=>{try{const r=localStorage.getItem(FB_STORE_KEY);return r?{...PREFILLED,...JSON.parse(r)} as FBConfig:null;}catch{return null;}};
const saveCfg=(c:FBConfig)=>{try{localStorage.setItem(FB_STORE_KEY,JSON.stringify(c));}catch{}};
let _app:FirebaseApp|null=null,_db:Database|null=null;
const initFB=(cfg:FBConfig):Database=>{if(!_app){_app=initializeApp(cfg);_db=getDatabase(_app);}return _db!;};
const getDb=():Database=>{if(_db)return _db;const c=loadCfg();if(c)return initFB(c);throw new Error("FB not ready");};
const fbRef=()=>ref(getDb(),"psAuction_v6");
const readSt=async():Promise<AuctionState>=>{const s=await get(fbRef());return s.exists()?s.val() as AuctionState:INIT_STATE;};
const writeSt=async(s:AuctionState)=>set(fbRef(),s);
const patchSt=async(p:Partial<AuctionState>)=>update(fbRef(),p);

// ─── TYPES ────────────────────────────────────────────────────────────────────
type Role="login"|"admin"|"captain"|"viewer";
type Phase="banner"|"running"|"done";
interface Player{id:number;name:string;role:string;tier:string;country:string;img:string;basePrice:number;soldTo:number|null;soldPrice:number|null;round:number|null;isCaptain?:boolean;}
interface SquadPlayer extends Player{soldPrice:number;isMarquee:boolean;round:number;isCaptain?:boolean;}
interface Team{id:number;name:string;short:string;color:string;accent:string;captainPass:string;purse:number;squad:SquadPlayer[];marqueeCount:number;captainPlayerId:number;}
interface LogItem{icon:string;text:string;time:string;}
interface AuctionState{queue:number[];curIdx:number;curBid:number;curBidder:number|null;aRound:number;phase:Phase;showSold:boolean;aDone:boolean;log:LogItem[];teams:Team[];players:Player[];dataVersion:number;lastSold?:{playerName:string;teamName:string;teamColor:string;teamId:number;price:number;}|null;}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const PURSE=800; const MIN_BID=5; const MAX_SQUAD=11; const MAX_MARQUEE=9;
const TOTAL_ROUNDS=3; const ADMIN_PASS="admin123"; const DATA_VERSION=6;
const safeArr=<T,>(a:T[]|null|undefined):T[]=>Array.isArray(a)?a:[];
const fmt=(v:number):string=>v>=100?`₹${(v/100).toFixed(1)}Cr`:`₹${v}L`;
const tc=(t:string):string=>({Elite:"#FFD700",Premium:"#00e5ff",Standard:"#69ff47"}[t]??"#aaa");

// ─── CAPTAIN PLAYER IDs ───────────────────────────────────────────────────────
const CAPTAIN_MAP:{[teamId:number]:number}={1:4,2:7,3:16}; // BI→Ashish(4), RK→Kannan(7), WW→Sandeep(16)

// ─── PRICING ─────────────────────────────────────────────────────────────────
const PLAYER_PRICES:Record<number,number>={1:70,2:50,3:45,4:90,5:75,6:50,7:100,8:55,9:80,10:70,11:45,12:65,13:75,14:70,15:50,16:90,17:40,18:50,19:60,20:45,21:40,22:45,23:55,24:65,25:50,26:60,27:75,28:60,29:55};

const RAW_PLAYERS=[
  {id:1,name:"Abdul Mubeen",role:"All-Rounder",img:"AM"},{id:2,name:"Amit Jadli",role:"Batsman / WK",img:"AJ"},
  {id:3,name:"Anshul Dikshit",role:"Batsman",img:"AD"},{id:4,name:"Ashish Negeet",role:"All-Rounder",img:"AN"},
  {id:5,name:"Janesh Chohan",role:"All-Rounder",img:"JC"},{id:6,name:"Jitendra Mistry",role:"Batsman",img:"JM"},
  {id:7,name:"Kannan Santharam",role:"All-Rounder",img:"KS"},{id:8,name:"Karthik Vempati",role:"Batsman",img:"KV"},
  {id:9,name:"Krunal Shah",role:"All-Rounder",img:"KSh"},{id:10,name:"Mahendra Negi",role:"All-Rounder",img:"MN"},
  {id:11,name:"Nikhil Surabhi",role:"Batsman",img:"NS"},{id:12,name:"Pradeep Patil",role:"Bowling All-Rounder",img:"PP"},
  {id:13,name:"Pranay Raj",role:"All-Rounder",img:"PR"},{id:14,name:"Rajat Mehrotra",role:"All-Rounder / WK",img:"RM"},
  {id:15,name:"Sameer Saxena",role:"Batsman",img:"SS"},{id:16,name:"Sandeep Kirpane",role:"All-Rounder",img:"SK"},
  {id:17,name:"Sanjay Prajapati",role:"Bowler",img:"SP"},{id:18,name:"Sanket Rana",role:"Batsman",img:"SRa"},
  {id:19,name:"Santosh Vaghmare",role:"Bowling All-Rounder",img:"SV"},{id:20,name:"Savan Paka",role:"Batsman",img:"SPa"},
  {id:21,name:"Sushil Page",role:"Batsman",img:"SuP"},{id:22,name:"Tushar More",role:"Bowler",img:"TM"},
  {id:23,name:"Vikramjeet Sangavkar",role:"Batsman / WK",img:"VS"},{id:24,name:"Vineet Shende",role:"All-Rounder",img:"VSh"},
  {id:25,name:"Srini Vellingiri",role:"Batsman",img:"SV2"},{id:26,name:"Aravind Kaluva",role:"Bowling All-Rounder",img:"AK"},
  {id:27,name:"Raghav Ambati",role:"Batting All-Rounder",img:"RA"},{id:28,name:"Karan Shah",role:"Bowling All-Rounder",img:"KSh2"},
  {id:29,name:"Vibhor",role:"Batsman / WK",img:"VB"},
];
const roleTier=(r:string):string=>r==="All-Rounder"?"Elite":r.includes("All-Rounder")?"Premium":"Standard";

// Pre-assign captains to their teams (not in auction pool)
const buildInitPlayers=():Player[]=>{
  return RAW_PLAYERS.map(p=>({
    ...p,tier:roleTier(p.role),country:"IND",
    basePrice:PLAYER_PRICES[p.id]??40,
    soldTo:null,soldPrice:null,round:null,isCaptain:false,
  }));
};

const buildInitTeams=():Team[]=>{
  const captainPrices:{[id:number]:number}={4:90,7:100,16:90};
  const teamsBase=[
    {id:1,name:"Blue Indians",short:"BI",color:"#1a56db",accent:"#FFD700",captainPass:"ashish123",captainPlayerId:4},
    {id:2,name:"Red Knights",short:"RK",color:"#c41e3a",accent:"#FFD700",captainPass:"kannan123",captainPlayerId:7},
    {id:3,name:"White Wolves",short:"WW",color:"#b0b8c8",accent:"#FFD700",captainPass:"sandeep123",captainPlayerId:16},
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
    return{...t,purse:PURSE,squad:[capSP],marqueeCount:1};
  });
};

const INIT_PLAYERS=buildInitPlayers();
const INIT_TEAMS=buildInitTeams();
const INIT_STATE:AuctionState={
  queue:[],curIdx:0,curBid:0,curBidder:null,
  aRound:0,phase:"banner",showSold:false,aDone:false,
  log:[],teams:INIT_TEAMS,players:INIT_PLAYERS,dataVersion:DATA_VERSION,lastSold:null,
};

// ─── SVG LOGOS ────────────────────────────────────────────────────────────────
const LogoParstriker=({size=48}:{size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#0a1628" stroke="#c41e3a" strokeWidth="3"/>
    <circle cx="50" cy="42" r="22" fill="#c41e3a" opacity="0.85"/>
    <ellipse cx="50" cy="36" rx="9" ry="10" fill="#1a56db"/>
    <rect x="44" y="46" width="12" height="18" rx="3" fill="#1a56db"/>
    <line x1="56" y1="50" x2="76" y2="28" stroke="#ffffff" strokeWidth="4" strokeLinecap="round"/>
    <rect x="72" y="23" width="6" height="10" rx="2" fill="#e8d5a0" transform="rotate(-45 72 23)"/>
    <circle cx="72" cy="52" r="5" fill="#ff4444" stroke="#fff" strokeWidth="1"/>
    <path d="M69 50 Q72 48 75 50" stroke="#fff" strokeWidth="1" fill="none"/>
    <ellipse cx="50" cy="88" rx="28" ry="5" fill="#1a56db" opacity="0.4"/>
    <circle cx="30" cy="78" r="4" fill="#0d1b2e"/><rect x="27" y="82" width="6" height="10" rx="2" fill="#0d1b2e"/>
    <circle cx="70" cy="80" r="4" fill="#0d1b2e"/><rect x="67" y="84" width="6" height="9" rx="2" fill="#0d1b2e"/>
  </svg>
);
const LogoBI=({size=48}:{size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#0d1b3e" stroke="#1a56db" strokeWidth="2.5"/>
    <path d="M38 20 Q32 10 26 8 Q30 16 28 24" fill="#1a56db"/>
    <path d="M42 18 Q38 7 32 4 Q37 13 35 21" fill="#2a66eb"/>
    <path d="M46 17 Q44 6 38 2 Q44 11 42 19" fill="#1a56db"/>
    <path d="M50 16 Q50 5 44 1 Q51 10 49 18" fill="#2a66eb"/>
    <path d="M54 17 Q56 6 62 2 Q55 11 57 19" fill="#1a56db"/>
    <path d="M58 30 Q62 28 64 34 Q66 42 62 52 Q58 60 52 64 Q46 68 42 64 Q36 58 36 48 Q36 36 42 30 Q48 24 58 30Z" fill="#1a56db"/>
    <circle cx="57" cy="41" r="2.5" fill="#0d1b3e"/>
    <path d="M44 50 Q48 54 52 52" stroke="#0d1b3e" strokeWidth="1.5" fill="none"/>
    <path d="M36 38 Q50 34 64 38" stroke="#FFD700" strokeWidth="2.5" fill="none"/>
    <path d="M44 64 Q40 72 38 82 Q50 85 62 82 Q60 72 56 64Z" fill="#1a56db"/>
  </svg>
);
const LogoRK=({size=48}:{size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#1a0008" stroke="#c41e3a" strokeWidth="2.5"/>
    <path d="M50 12 Q42 8 36 14 Q40 16 38 22 Q44 16 50 18Z" fill="#c41e3a"/>
    <path d="M50 12 Q50 6 46 8 Q48 14 50 18Z" fill="#e03050"/>
    <path d="M50 12 Q58 8 64 14 Q60 16 62 22 Q56 16 50 18Z" fill="#c41e3a"/>
    <path d="M28 45 Q26 32 34 24 Q42 18 50 18 Q58 18 66 24 Q74 32 72 45 Q72 58 66 64 Q60 70 50 72 Q40 70 34 64 Q28 58 28 45Z" fill="#c41e3a"/>
    <path d="M30 46 Q34 42 50 42 Q66 42 70 46 Q68 54 50 56 Q32 54 30 46Z" fill="#8b1020"/>
    <rect x="34" y="44" width="14" height="3" rx="1.5" fill="#1a0008"/>
    <rect x="34" y="49" width="14" height="3" rx="1.5" fill="#1a0008"/>
    <rect x="52" y="44" width="14" height="3" rx="1.5" fill="#1a0008"/>
    <rect x="52" y="49" width="14" height="3" rx="1.5" fill="#1a0008"/>
    <path d="M36 64 Q38 74 50 76 Q62 74 64 64 Q58 68 50 68 Q42 68 36 64Z" fill="#c41e3a"/>
  </svg>
);
const LogoWW=({size=48}:{size?:number})=>(
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#12141a" stroke="#8090aa" strokeWidth="2.5"/>
    <path d="M28 36 Q24 20 32 16 Q36 26 34 34Z" fill="#b0b8c8"/>
    <path d="M30 30 Q28 22 33 18 Q35 25 33 30Z" fill="#6070a0"/>
    <path d="M72 36 Q76 20 68 16 Q64 26 66 34Z" fill="#b0b8c8"/>
    <path d="M70 30 Q72 22 67 18 Q65 25 67 30Z" fill="#6070a0"/>
    <path d="M22 54 Q20 40 28 32 Q36 24 50 24 Q64 24 72 32 Q80 40 78 54 Q76 66 66 72 Q58 78 50 78 Q42 78 34 72 Q24 66 22 54Z" fill="#b0b8c8"/>
    <path d="M36 58 Q40 66 50 68 Q60 66 64 58 Q60 60 50 62 Q40 60 36 58Z" fill="#8090a8"/>
    <path d="M42 58 Q50 64 58 58 Q54 56 50 57 Q46 56 42 58Z" fill="#d0d8e8"/>
    <path d="M44 54 Q50 52 56 54 Q52 58 50 57 Q48 58 44 54Z" fill="#2a2e3a"/>
    <ellipse cx="38" cy="46" rx="6" ry="5" fill="#e8e0f0"/><circle cx="39" cy="46" r="3.5" fill="#4060c0"/>
    <circle cx="40" cy="45" r="1.5" fill="#0a0a14"/><circle cx="41" cy="44" r="1" fill="#ffffff" opacity="0.7"/>
    <ellipse cx="62" cy="46" rx="6" ry="5" fill="#e8e0f0"/><circle cx="61" cy="46" r="3.5" fill="#4060c0"/>
    <circle cx="62" cy="45" r="1.5" fill="#0a0a14"/><circle cx="63" cy="44" r="1" fill="#ffffff" opacity="0.7"/>
  </svg>
);
const LOGOS:Record<number,(p:{size?:number})=>JSX.Element>={1:LogoBI,2:LogoRK,3:LogoWW};
const TeamLogo=({teamId,size=40}:{teamId:number;size?:number})=>{const L=LOGOS[teamId];return L?<L size={size}/>:<div style={{width:size,height:size,borderRadius:"50%",background:"#333",display:"flex",alignItems:"center",justifyContent:"center",fontSize:size/3,color:"#fff"}}>?</div>;};

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@500;700&family=DM+Sans:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#05050e;--s1:#0c0c1a;--s2:#12121f;--s3:#1a1a2e;--bd:#25253d;--gold:#FFD700;--cyan:#00e5ff;--green:#69ff47;--txt:#f0f0ff;--mut:#5555aa;--ok:#00ff88;--ng:#ff3355;--warn:#ff9900;}
body{background:var(--bg);color:var(--txt);font-family:'DM Sans',sans-serif;min-height:100vh;overflow-x:hidden}

/* SETUP */
.sw{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;
  background:radial-gradient(ellipse at 20% 20%,rgba(0,229,255,.08),transparent 50%),radial-gradient(ellipse at 80% 80%,rgba(255,215,0,.07),transparent 50%),var(--bg)}
.sb2{background:linear-gradient(145deg,#0f0f22,#0a0a18);border:1px solid rgba(0,229,255,.3);border-radius:20px;padding:32px 28px;width:100%;max-width:460px;box-shadow:0 0 40px rgba(0,229,255,.1)}
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
.sbtn{width:100%;margin-top:14px;padding:14px;background:linear-gradient(135deg,var(--gold),var(--cyan));border:none;border-radius:11px;color:#000;font-family:'Bebas Neue';font-size:19px;letter-spacing:3px;cursor:pointer;transition:all .25s;font-weight:900}
.sbtn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(255,215,0,.3)}

/* CONNECTING */
.conn{min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;background:var(--bg)}
.spin{width:44px;height:44px;border:3px solid rgba(0,229,255,.15);border-top-color:var(--cyan);border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* HEADER */
.hdr{background:linear-gradient(90deg,#05050e,#0a0520,#05050e);border-bottom:1px solid rgba(0,229,255,.15);padding:10px 18px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:200;backdrop-filter:blur(20px)}
.hlw{display:flex;align-items:center;gap:10px}
.hl{font-family:'Bebas Neue';font-size:20px;letter-spacing:3px;background:linear-gradient(90deg,var(--gold),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.1}
.hl-sub{font-size:9px;color:var(--mut);letter-spacing:2px;font-family:'Rajdhani'}
.hr{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rp{padding:3px 11px;border-radius:20px;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border:1px solid}
.xb{background:transparent;border:1px solid var(--bd);color:var(--mut);padding:5px 12px;border-radius:7px;cursor:pointer;font-size:11px;transition:all .2s}
.xb:hover{border-color:var(--ng);color:var(--ng)}
.nb{background:transparent;border:1px solid var(--ng);color:var(--ng);padding:5px 12px;border-radius:7px;cursor:pointer;font-size:11px}

/* NAV */
.nav{background:rgba(0,0,0,.4);border-bottom:1px solid var(--bd);padding:0 18px;display:flex;gap:2px;overflow-x:auto;backdrop-filter:blur(10px)}
.nt{background:transparent;border:none;color:var(--mut);padding:12px 14px;cursor:pointer;font-family:'Rajdhani';font-weight:700;font-size:12px;letter-spacing:1px;border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap}
.nt:hover{color:var(--txt)} .nt.on{color:var(--gold);border-bottom-color:var(--gold)}

/* LOGIN */
.lw{min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:16px;
  background:radial-gradient(ellipse at 25% 25%,rgba(255,215,0,.06),transparent 50%),radial-gradient(ellipse at 75% 75%,rgba(0,229,255,.06),transparent 50%),var(--bg)}
.lhero{display:flex;flex-direction:column;align-items:center;margin-bottom:24px;gap:8px}
.lhero-name{font-family:'Bebas Neue';font-size:13px;letter-spacing:5px;color:var(--mut)}
.lhero-title{font-family:'Bebas Neue';font-size:34px;letter-spacing:6px;background:linear-gradient(90deg,var(--gold),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.lhero-tag{font-size:10px;color:var(--mut);letter-spacing:3px}
.lb{background:linear-gradient(145deg,#0f0f22,#0a0a18);border:1px solid rgba(255,215,0,.2);border-radius:22px;padding:32px 28px;width:100%;max-width:380px;box-shadow:0 0 50px rgba(255,215,0,.08)}
.ls{color:var(--mut);font-size:12px;margin-bottom:22px;text-align:center}
.rg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:18px}
.rb{background:rgba(255,255,255,.03);border:1px solid var(--bd);border-radius:12px;padding:14px 8px;cursor:pointer;transition:all .2s;color:var(--txt);text-align:center}
.rb:hover{border-color:rgba(255,215,0,.4);background:rgba(255,215,0,.04)}
.rb.sel{border-color:var(--gold);background:rgba(255,215,0,.07);box-shadow:0 0 12px rgba(255,215,0,.15)}
.ri{font-size:22px;margin-bottom:5px} .rn{font-family:'Rajdhani';font-weight:700;font-size:13px;letter-spacing:1px;color:var(--gold)} .rh{font-size:9px;color:var(--mut);margin-top:2px}
.inp{width:100%;background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.2);border-radius:9px;padding:11px 14px;color:var(--txt);font-size:13px;outline:none;transition:all .2s;margin-bottom:10px}
.inp:focus{border-color:var(--cyan);box-shadow:0 0 10px rgba(0,229,255,.12)}
.gb{width:100%;padding:14px;background:linear-gradient(135deg,var(--gold),#ff9900);border:none;border-radius:11px;color:#000;font-family:'Bebas Neue';font-size:19px;letter-spacing:3px;cursor:pointer;transition:all .2s;font-weight:900}
.gb:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(255,215,0,.35)} .gb:disabled{opacity:.35;cursor:not-allowed;transform:none}
.em{color:var(--ng);font-size:11px;margin-bottom:8px;background:rgba(255,51,85,.1);border:1px solid rgba(255,51,85,.3);border-radius:7px;padding:7px 10px}
.ht{margin-top:12px;font-size:10px;color:var(--mut);line-height:1.8;text-align:center}

/* ROUND BANNER */
.rbn{text-align:center;padding:36px 24px;max-width:580px;margin:0 auto}
.rbe{font-family:'Rajdhani';font-size:11px;letter-spacing:4px;color:var(--mut);text-transform:uppercase;margin-bottom:8px}
.rbt{font-family:'Bebas Neue';font-size:52px;letter-spacing:5px;margin-bottom:10px;background:linear-gradient(90deg,var(--gold),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.rbd{color:var(--mut);font-size:13px;margin-bottom:24px;line-height:1.7}
.rbb{padding:14px 40px;background:linear-gradient(135deg,var(--gold),#ff9900);border:none;border-radius:12px;color:#000;font-family:'Bebas Neue';font-size:21px;letter-spacing:3px;cursor:pointer;transition:all .25s;font-weight:900}
.rbb:hover{transform:translateY(-3px);box-shadow:0 10px 30px rgba(255,215,0,.4)}

/* AUCTION LAYOUT */
.al{display:grid;grid-template-columns:1fr 300px;min-height:calc(100vh - 108px)}
.stg{padding:18px;overflow-y:auto;background:radial-gradient(ellipse at 50% 0%,rgba(0,229,255,.05),transparent 60%),var(--bg)}
.st{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px}
.rpill{padding:4px 12px;border-radius:20px;font-family:'Rajdhani';font-weight:700;font-size:11px;letter-spacing:1px;background:rgba(255,215,0,.1);color:var(--gold);border:1px solid rgba(255,215,0,.3)}
.pb{background:rgba(255,255,255,.08);border-radius:4px;height:4px;width:140px;margin-top:4px}
.pf{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--gold),var(--cyan));transition:width .5s}
.spl{background:linear-gradient(145deg,rgba(0,229,255,.05),rgba(255,215,0,.03));border:1px solid rgba(0,229,255,.2);border-radius:20px;padding:24px;text-align:center;margin-bottom:14px;position:relative;overflow:hidden}
.spl::before{content:'';position:absolute;top:-40%;left:-20%;width:140%;height:140%;background:radial-gradient(ellipse,rgba(255,215,0,.04),transparent 55%);pointer-events:none}
.tt{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.05);border-radius:20px;padding:4px 12px;margin-bottom:12px;font-size:10px;font-weight:700;letter-spacing:1.5px;border:1px solid}
.pav{width:76px;height:76px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue';font-size:18px;margin:0 auto 10px;border:3px solid}
.pn{font-family:'Bebas Neue';font-size:32px;letter-spacing:3px;line-height:1;margin-bottom:8px}
.pm{display:flex;justify-content:center;gap:7px;margin-bottom:14px;flex-wrap:wrap}
.ch{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:3px 10px;font-size:11px;color:var(--txt)}
.bb{background:rgba(0,0,0,.4);border:1px solid rgba(255,215,0,.15);border-radius:12px;padding:14px;margin-bottom:14px}
.bl{font-size:9px;color:var(--mut);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:2px}
.ba{font-family:'Bebas Neue';font-size:44px;letter-spacing:2px;line-height:1;background:linear-gradient(90deg,var(--gold),#ff9900);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.bs{font-size:11px;color:var(--mut);margin-top:2px}
.bldr{font-family:'Rajdhani';font-size:13px;font-weight:700;margin-top:5px}
.bg{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:9px}
.tbb{padding:10px 7px;border-radius:10px;border:2px solid;cursor:pointer;font-family:'Rajdhani';font-weight:700;font-size:11px;transition:all .2s;text-align:left}
.tbb:disabled{opacity:.25;cursor:not-allowed} .tbb:not(:disabled):hover{transform:translateY(-2px)}
.tdg{font-family:'Bebas Neue';font-size:11px;letter-spacing:1.5px;padding:2px 5px;border-radius:3px}
.ar{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.sdb{background:linear-gradient(135deg,var(--ok),#00cc66);border:none;border-radius:10px;color:#000;padding:12px;font-family:'Bebas Neue';font-size:18px;letter-spacing:2px;cursor:pointer;transition:all .2s;font-weight:900}
.sdb:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,255,136,.3)} .sdb:disabled{opacity:.35;cursor:not-allowed}
.usb{background:transparent;border:2px solid var(--bd);border-radius:10px;color:var(--mut);padding:12px;font-family:'Bebas Neue';font-size:18px;letter-spacing:2px;cursor:pointer;transition:all .2s}
.usb:hover:not(:disabled){border-color:var(--ng);color:var(--ng)} .usb:disabled{opacity:.35;cursor:not-allowed}

/* SOLD OVERLAY */
.so{position:absolute;inset:0;background:rgba(0,0,0,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:20px;z-index:10;animation:fi .3s ease}
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
.li{font-size:11px;flex-shrink:0;margin-top:1px} .lt{font-size:10px;line-height:1.4;flex:1} .ltime{font-size:8px;color:var(--mut)}

/* ─── CAPTAIN DASHBOARD ─── */
.cap-layout{display:grid;grid-template-columns:1fr 280px;min-height:calc(100vh - 108px);max-height:calc(100vh - 108px);overflow:hidden}
.cap-main{padding:16px;overflow-y:auto;background:radial-gradient(ellipse at 50% 0%,rgba(255,215,0,.04),transparent 60%),var(--bg)}
.cap-side{background:rgba(0,0,0,.6);border-left:1px solid var(--bd);overflow-y:auto;backdrop-filter:blur(10px)}

/* Captain purse strip */
.cap-purse-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}
.cap-stat{background:linear-gradient(145deg,var(--s2),var(--s1));border:1px solid var(--bd);border-radius:11px;padding:12px;text-align:center;transition:all .3s}
.cap-stat.glow-gold{border-color:rgba(255,215,0,.5);box-shadow:0 0 16px rgba(255,215,0,.15)}
.cap-stat.glow-red{border-color:rgba(255,51,85,.5);box-shadow:0 0 16px rgba(255,51,85,.2)}
.csv{font-family:'Bebas Neue';font-size:24px;letter-spacing:1px}
.csl{font-size:8px;color:var(--mut);text-transform:uppercase;letter-spacing:1px;margin-top:2px}

/* Bidding stage for captain */
.bid-stage{background:linear-gradient(145deg,rgba(0,229,255,.06),rgba(255,215,0,.04));border:2px solid rgba(255,215,0,.15);border-radius:18px;padding:20px;text-align:center;transition:all .3s;margin-bottom:16px}
.bid-stage.hot{border-color:rgba(255,215,0,.6);box-shadow:0 0 30px rgba(255,215,0,.15),inset 0 0 30px rgba(255,215,0,.03);animation:stagePulse 2s infinite}
@keyframes stagePulse{0%,100%{box-shadow:0 0 30px rgba(255,215,0,.15)}50%{box-shadow:0 0 50px rgba(255,215,0,.3)}}
.bid-stage.leading{border-color:rgba(0,255,136,.6);box-shadow:0 0 30px rgba(0,255,136,.2)}
.nm{color:var(--mut);font-size:13px;padding:44px 0}

/* Big bid display */
.cur-bid-display{background:rgba(0,0,0,.5);border-radius:14px;padding:16px;margin:12px 0}
.cbd-label{font-size:9px;color:var(--mut);text-transform:uppercase;letter-spacing:2px;margin-bottom:4px}
.cbd-amount{font-family:'Bebas Neue';font-size:52px;line-height:1;background:linear-gradient(90deg,var(--gold),#ff9900);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.cbd-amount.leading-amount{background:linear-gradient(90deg,var(--ok),#00cc66);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.cbd-leader{font-family:'Rajdhani';font-size:14px;font-weight:700;margin-top:6px;padding:5px 14px;border-radius:20px;display:inline-block}

.cbb{width:100%;margin-top:14px;padding:18px;border:none;border-radius:13px;color:#000;font-family:'Bebas Neue';font-size:24px;letter-spacing:4px;cursor:pointer;transition:all .25s;font-weight:900;position:relative;overflow:hidden}
.cbb:hover:not(:disabled){transform:translateY(-3px)}
.cbb:disabled{opacity:.32;cursor:not-allowed}
.cbb::after{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(ellipse,rgba(255,255,255,.2),transparent 60%);pointer-events:none;opacity:0;transition:opacity .2s}
.cbb:hover::after{opacity:1}

/* Captain side panel */
.cap-side-sec{padding:12px;border-bottom:1px solid var(--bd)}
.cap-side-title{font-family:'Rajdhani';font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:var(--mut);margin-bottom:10px}
.cap-squad-item{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.cap-squad-item:last-child{border-bottom:none}
.cap-sq-av{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue';font-size:8px;border:1.5px solid;flex-shrink:0}
.cap-sq-info{flex:1}
.cap-sq-name{font-size:11px;font-weight:600;line-height:1.2}
.cap-sq-role{font-size:9px;color:var(--mut)}
.cap-sq-price{font-family:'Rajdhani';font-weight:700;font-size:11px;color:var(--gold)}

/* PLAYER POOL */
.pgw{padding:14px;max-width:1000px;margin:0 auto}
.fr{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}
.fb{background:rgba(255,255,255,.04);border:1px solid var(--bd);color:var(--mut);padding:4px 11px;border-radius:14px;cursor:pointer;font-size:11px;transition:all .2s}
.fb.on,.fb:hover{border-color:var(--gold);color:var(--gold);background:rgba(255,215,0,.06)}
.pgg{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:8px}
.pc{background:linear-gradient(145deg,var(--s2),var(--s1));border:1px solid rgba(255,255,255,.07);border-radius:11px;padding:12px;transition:all .2s}
.pc:hover{border-color:rgba(255,215,0,.2);transform:translateY(-2px)} .pc.sp{opacity:.5}
.pcav{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue';font-size:10px;border:2px solid;margin-bottom:7px}
.pcn{font-family:'Rajdhani';font-weight:700;font-size:12px;margin-bottom:2px;line-height:1.2}
.pcr{font-size:9px;color:var(--mut);margin-bottom:5px;line-height:1.3}
.pctb{font-size:8px;padding:2px 6px;border-radius:7px;background:rgba(255,255,255,.06);display:inline-block}
.pcs{font-size:9px;color:var(--ok);font-weight:700;margin-top:4px} .pcb{font-size:9px;color:var(--mut);margin-top:3px}

/* TEAM CARDS */
.tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;padding:16px;max-width:960px;margin:0 auto}
.tfc{border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.08);background:linear-gradient(145deg,var(--s2),var(--s1));transition:all .3s}
.tfc:hover{transform:translateY(-3px)}
.tfh{padding:14px 16px;display:flex;align-items:center;gap:12px;position:relative;overflow:hidden}
.tfn{font-family:'Bebas Neue';font-size:17px;letter-spacing:2px;flex:1}
.tfs{display:flex;gap:6px;padding:0 14px 12px}
.tv{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:7px;padding:7px 9px;flex:1;text-align:center}
.tvv{font-family:'Rajdhani';font-weight:700;font-size:15px} .tvl{font-size:8px;color:var(--mut);text-transform:uppercase;letter-spacing:1px}
.tfl{padding:0 14px 14px}
.tpr{display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.tpr:last-child{border-bottom:none}
.tpa{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;border:1.5px solid;flex-shrink:0}
.tpi{flex:1} .tpn{font-size:11px;font-weight:600} .tps{font-size:9px;color:var(--mut)}
.tpp{font-family:'Rajdhani';font-weight:700;font-size:10px;color:var(--gold)}
.mq{font-size:7px;background:var(--gold);color:#000;padding:1px 3px;border-radius:2px;font-weight:700;margin-left:3px}
.cap-tag{font-size:7px;background:var(--cyan);color:#000;padding:1px 4px;border-radius:2px;font-weight:700;margin-left:3px;letter-spacing:.5px}

/* VIEWER */
.vtk{padding:8px 16px;display:flex;align-items:center;gap:9px;overflow:hidden;background:rgba(0,229,255,.05);border-bottom:1px solid rgba(0,229,255,.15)}
.vld{background:var(--ng);color:#fff;font-size:8px;font-weight:700;padding:2px 5px;border-radius:3px;letter-spacing:1px;animation:pulse 1.5s infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.vtxt{font-size:11px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ─── POPUP OVERLAYS ─── */
.overlay-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;animation:fi .3s ease;backdrop-filter:blur(8px)}

/* Viewer sold popup */
.viewer-sold-popup{background:linear-gradient(145deg,#0f0f22,#0a0a18);border:2px solid;border-radius:22px;padding:32px 28px;text-align:center;max-width:360px;width:100%;position:relative;animation:popIn .4s cubic-bezier(.175,.885,.32,1.275)}
@keyframes popIn{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}
.vsp-player{font-family:'Bebas Neue';font-size:36px;letter-spacing:3px;margin:12px 0 6px;line-height:1}
.vsp-role{font-size:12px;color:var(--mut);margin-bottom:16px}
.vsp-selected{font-family:'Bebas Neue';font-size:16px;letter-spacing:3px;color:var(--mut);margin-bottom:8px}
.vsp-team{font-family:'Bebas Neue';font-size:28px;letter-spacing:3px;margin-bottom:6px}
.vsp-close{margin-top:20px;padding:10px 28px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:10px;color:var(--txt);font-family:'Bebas Neue';font-size:16px;letter-spacing:2px;cursor:pointer}

/* Captain celebration popup */
.cap-celeb-popup{background:linear-gradient(145deg,#0a1a08,#0a0a18);border:2px solid var(--ok);border-radius:24px;padding:36px 30px;text-align:center;max-width:400px;width:100%;position:relative;animation:popIn .4s cubic-bezier(.175,.885,.32,1.275);box-shadow:0 0 60px rgba(0,255,136,.3)}
.confetti{font-size:28px;animation:confettiFall 1s ease-out infinite alternate}
@keyframes confettiFall{from{transform:translateY(0) rotate(0deg)}to{transform:translateY(-8px) rotate(20deg)}}
.celeb-title{font-family:'Bebas Neue';font-size:38px;letter-spacing:4px;color:var(--ok);margin:10px 0 4px;text-shadow:0 0 20px rgba(0,255,136,.5)}
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
.ps-footer{text-align:center;padding:18px 16px;border-top:1px solid rgba(255,215,0,.08);background:linear-gradient(0deg,rgba(255,215,0,.03),transparent);margin-top:8px}
.ps-footer-txt{font-family:'Rajdhani';font-size:11px;letter-spacing:2px;color:rgba(255,215,0,.35);text-transform:uppercase}
.ps-footer-txt span{background:linear-gradient(90deg,var(--gold),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;font-weight:700;letter-spacing:3px}

.sync-toast{position:fixed;bottom:12px;right:12px;background:rgba(0,229,255,.12);border:1px solid rgba(0,229,255,.3);border-radius:8px;padding:6px 12px;font-size:11px;color:var(--cyan);z-index:999;backdrop-filter:blur(10px)}

::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:var(--s1)} ::-webkit-scrollbar-thumb{background:var(--bd);border-radius:3px}

@media(max-width:680px){
  .al{grid-template-columns:1fr} .sb{max-height:220px;border-left:none;border-top:1px solid var(--bd)}
  .cap-layout{grid-template-columns:1fr} .cap-side{max-height:280px;border-left:none;border-top:1px solid var(--bd)}
  .pn{font-size:24px} .ba{font-size:32px} .bg{grid-template-columns:repeat(3,1fr)}
  .cap-purse-strip{grid-template-columns:repeat(2,1fr)} .nt{padding:10px 9px;font-size:11px}
}
`;

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [fbReady,setFbReady]=useState<boolean>(()=>loadCfg()!==null);
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
                queue:safeArr(raw.queue),log:safeArr(raw.log),
                teams:safeArr(raw.teams).map(t=>({...t,squad:safeArr(t.squad)})),
                players:safeArr(raw.players),
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
  const write=useCallback(async(next:AuctionState)=>{setSaving(true);try{await writeSt(next);}catch(e){console.error(e);}setSaving(false);},[]);
  const patch=useCallback(async(p:Partial<AuctionState>)=>{setSaving(true);try{await patchSt(p);}catch(e){console.error(e);}setSaving(false);},[]);

  const startRound=async(round:number)=>{
    const snap=await readSt();
    const captainIds=Object.values(CAPTAIN_MAP);
    const sorted=[...safeArr(snap.players)]
      .filter(p=>!captainIds.includes(p.id)) // exclude captains from auction
      .sort((a,b)=>b.basePrice-a.basePrice);
    const queue=round===1?sorted.map(p=>p.id):sorted.filter(p=>p.soldTo===null).map(p=>p.id);
    if(!queue.length){alert("No unsold players!");return;}
    const first=snap.players.find(p=>p.id===queue[0]);
    const log=addLog(snap,"🎙️",`Round ${round} started! ${queue.length} players.`);
    await write({...snap,queue,curIdx:0,curBid:first?.basePrice??20,curBidder:null,aRound:round,phase:"running",showSold:false,log,lastSold:null});
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
    const lastSold={playerName:cp.name,teamName:team.name,teamColor:team.color,teamId:team.id,price:snap.curBid};
    // Captain celebration: if the winning captain is viewing this session
    const winnerTeam=newTeams.find(t=>t.id===snap.curBidder);
    if(teamId===snap.curBidder&&winnerTeam){
      setCelebPopup({playerName:cp.name,price:snap.curBid,purseLeft:winnerTeam.purse});
    }
    await write({...snap,teams:newTeams,players:newPlayers,showSold:true,log,lastSold});
    setTimeout(()=>advance(),2100);
  };

  const doUnsold=async()=>{
    const snap=await readSt();
    const cp=safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[snap.curIdx]);
    if(!cp)return;
    const log=addLog(snap,"❌",`${cp.name} UNSOLD (Round ${snap.aRound})`);
    await patch({log,lastSold:null} as Partial<AuctionState>);
    advance();
  };

  const advance=async()=>{
    const snap=await readSt();
    const next=snap.curIdx+1;
    if(next>=safeArr(snap.queue).length){
      if(snap.aRound>=TOTAL_ROUNDS){
        const log=addLog(snap,"🏆","All rounds done! Parstriker Auction complete!");
        await write({...snap,showSold:false,aDone:true,phase:"done",log,lastSold:null});
      } else {
        const log=addLog(snap,"🔔",`Round ${snap.aRound} complete! Unsold players re-enter.`);
        await write({...snap,showSold:false,phase:"banner",log,lastSold:null});
      }
    } else {
      const np=safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[next]);
      await patch({curIdx:next,curBid:np?.basePrice??20,curBidder:null,showSold:false,lastSold:null} as Partial<AuctionState>);
    }
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
          <div style={{fontSize:40}}>🎉🏏🎉</div>
          <div className="celeb-title">YOU GOT HIM!</div>
          <div className="celeb-player">{celebPopup.playerName}</div>
          <div style={{fontSize:11,color:"var(--mut)",marginBottom:4}}>SOLD TO YOUR TEAM FOR</div>
          <div className="celeb-price">{fmt(celebPopup.price)}</div>
          <div className="celeb-purse">Purse remaining: {fmt(celebPopup.purseLeft)}</div>
          <div style={{display:"flex",justifyContent:"center",gap:8,margin:"12px 0 0",fontSize:24}}>
            {["🎊","⭐","🏆","⭐","🎊"].map((e,i)=><span key={i} style={{animation:`confettiFall ${0.8+i*0.1}s ease-out infinite alternate`}}>{e}</span>)}
          </div>
          <button className="celeb-close" onClick={()=>setCelebPopup(null)}>AWESOME! 🎯</button>
        </div>
      </div>
    )}

    {role==="login"&&<LoginScreen teams={safeArr(st.teams)} onLogin={(r,tid)=>{setRole(r);if(tid!==undefined)setTeamId(tid);}}/>}
    {role==="admin"&&<AdminView st={st} curPlayer={curPlayer} leadTeam={leadTeam} soldCount={soldCount} progPct={progPct} onBid={placeBid} onSold={doSold} onUnsold={doUnsold} onStartRound={startRound} onLogout={logout} onReset={resetAll} canBid={canBid}/>}
    {role==="captain"&&myTeam&&<CaptainView myTeam={myTeam} st={st} curPlayer={curPlayer} onBid={placeBid} onLogout={logout} canBid={canBid(myTeam)}/>}
    {role==="viewer"&&<ViewerView st={st} curPlayer={curPlayer} leadTeam={leadTeam} soldCount={soldCount} onLogout={logout}/>}
  </>);
}

// ─── FIREBASE SETUP ───────────────────────────────────────────────────────────
function FirebaseSetup({onSave}:{onSave:(c:FBConfig)=>void}){
  const [sid,setSid]=useState("");const [err,setErr]=useState("");
  const save=()=>{setErr("");const id=sid.trim();if(!id){setErr("Please enter Messaging Sender ID");return;}if(!/^\d+$/.test(id)){setErr("Numbers only");return;}onSave({...PREFILLED as FBConfig,messagingSenderId:id});};
  return(
    <div className="sw"><div className="sb2">
      <div className="slogo"><LogoParstriker size={52}/><div><div className="slt">PARSTRIKER</div><div className="ssub" style={{textAlign:"left",marginBottom:0}}>AUCTION SETUP</div></div></div>
      <div style={{height:16}}/>
      <div className="spre"><div className="spret">✅ Pre-configured</div>
        {[["Project","parstriker-auction"],["Database","parstriker-auction-rtdb"],["API Key","AIzaSyD3k2•••F7I4"],["App ID","1:1400•••45"]].map(([l,v])=>(<div key={l} className="sprer"><span className="sprel">{l}</span><span className="sprev">{v}</span></div>))}
      </div>
      <div className="sdesc">Enter your <b>Messaging Sender ID</b>.<br/>Firebase Console → ⚙️ Project Settings → General → <b>Project number</b></div>
      {err&&<div className="serr">⚠ {err}</div>}
      <div className="sfield"><label className="slbl">Messaging Sender ID</label>
        <input className="sinp" placeholder="e.g. 1400458016" value={sid} onChange={e=>setSid(e.target.value.trim())} onKeyDown={e=>e.key==="Enter"&&save()} autoFocus/>
      </div>
      <button className="sbtn" onClick={save}>🔥 CONNECT &amp; LAUNCH</button>
      <div style={{marginTop:10,fontSize:10,color:"var(--mut)",textAlign:"center",lineHeight:1.7}}>Saved in browser · Enter once per device</div>
    </div></div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({teams,onLogin}:{teams:Team[];onLogin:(r:Role,tid?:number)=>void}){
  const [sel,setSel]=useState<Role|null>(null);const [pass,setPass]=useState("");const [err,setErr]=useState("");
  const tryLogin=()=>{setErr("");if(!sel)return;if(sel==="viewer"){onLogin("viewer");return;}if(sel==="admin"){pass===ADMIN_PASS?onLogin("admin"):setErr("Wrong admin password");return;}const team=teams.find(t=>t.captainPass===pass);team?onLogin("captain",team.id):setErr("Wrong captain password");};
  return(
    <div className="lw">
      <div className="lhero">
        <LogoParstriker size={80}/>
        <div className="lhero-name">PARSIPPANY</div>
        <div className="lhero-title">PARSTRIKER</div>
        <div className="lhero-tag">— UNLEASHING THE SPIRIT OF CRICKET —</div>
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
        <button className="gb" disabled={!sel} onClick={tryLogin}>ENTER</button>
        <div className="ht">Contact the auction organiser for your password</div>
      </div>
      <Footer/>
    </div>
  );
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
function AdminView({st,curPlayer,leadTeam,soldCount,progPct,onBid,onSold,onUnsold,onStartRound,onLogout,onReset,canBid}:{
  st:AuctionState;curPlayer:Player|undefined;leadTeam:Team|undefined;soldCount:number;progPct:number;
  onBid:(id:number)=>void;onSold:()=>void;onUnsold:()=>void;onStartRound:(r:number)=>void;onLogout:()=>void;onReset:()=>void;canBid:(t:Team)=>boolean;
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
      st.aDone?<DoneScreen teams={teams}/>:
      st.phase==="banner"?(
        <div>
          <div className="rbn">
            <div className="rbe">{st.aRound===0?"WELCOME TO":"ROUND "+st.aRound+" COMPLETE"}</div>
            <div className="rbt">{st.aRound===0?"PARSTRIKER AUCTION":`ROUND ${st.aRound+1} OF ${TOTAL_ROUNDS}`}</div>
            <div className="rbd">
              {st.aRound===0?`${auctionPlayers.length} players in pool · ${TOTAL_ROUNDS} rounds · ${teams.length} teams · Purse ${fmt(PURSE)} each`
                :`${auctionPlayers.filter(p=>p.soldTo===null).length} unsold players re-enter · Round ${st.aRound+1} of ${TOTAL_ROUNDS}`}
            </div>
            <button className="rbb" onClick={()=>onStartRound(st.aRound+1)}>{st.aRound===0?"⚡ START AUCTION":`▶ BEGIN ROUND ${st.aRound+1}`}</button>
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
                <div style={{fontSize:10,color:"var(--mut)"}}>Sold: {soldCount}/{auctionPlayers.length}</div>
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
                <div className="pm"><span className="ch">🏏 {curPlayer.role}</span><span className="ch">Base {fmt(curPlayer.basePrice)}</span></div>
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
                  return(<button key={team.id} className="tbb" disabled={!able}
                    style={{borderColor:isLead?team.color:"var(--bd)",background:isLead?`${team.color}22`:"var(--s2)",color:isLead?team.color:"var(--txt)"}}
                    onClick={()=>onBid(team.id)}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <TeamLogo teamId={team.id} size={24}/>
                      {able&&<span style={{fontSize:9,color:"var(--gold)",fontFamily:"'Bebas Neue'"}}>{fmt(nb)}</span>}
                    </div>
                    <div className="tdg" style={{background:`${team.color}22`,color:team.color}}>{team.short}</div>
                    <div style={{fontSize:8,opacity:.55,marginTop:2}}>{fmt(team.purse)}</div>
                    {isLead&&<div style={{fontSize:8,color:"var(--ok)",marginTop:1}}>● LEADING</div>}
                    {safeArr(team.squad).length>=MAX_SQUAD&&<div style={{fontSize:8,color:"var(--ng)",marginTop:1}}>FULL</div>}
                  </button>);
                })}
              </div>
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
          <div style={{fontSize:11,color:"var(--mut)"}}>{soldCount} sold · {auctionPlayers.filter(p=>p.soldTo===null).length} available · 3 captains pre-assigned</div>
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
function CaptainView({myTeam,st,curPlayer,onBid,onLogout,canBid}:{
  myTeam:Team;st:AuctionState;curPlayer:Player|undefined;onBid:(id:number)=>void;onLogout:()=>void;canBid:boolean;
}){
  const isLeading=st.curBidder===myTeam.id;
  const pctLeft=(myTeam.purse/PURSE)*100;
  const nextBid=st.curBidder!==null?st.curBid+MIN_BID:curPlayer?.basePrice??0;
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
        <div className="cap-purse-strip">
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
        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          {allTeams.filter(t=>t.id!==myTeam.id).map(t=>{
            const pct=(t.purse/PURSE)*100;
            const isLead=t.id===st.curBidder;
            return(<div key={t.id} style={{flex:1,minWidth:120,background:isLead?`${t.color}15`:"rgba(255,255,255,.03)",
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
          {st.phase==="banner"&&<div className="nm">⏳ Waiting for admin to start the auction…</div>}
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
            <div style={{display:"flex",justifyContent:"center",gap:7,flexWrap:"wrap"}}>
              <span className="ch">{curPlayer.role}</span>
              <span className="ch">Base {fmt(curPlayer.basePrice)}</span>
            </div>

            {/* Big bid display */}
            <div className="cur-bid-display">
              <div className="cbd-label">
                {isLeading?"🔥 YOU ARE LEADING!":st.curBidder!==null?"⚡ BID IN PROGRESS":"🎯 OPENING PRICE"}
              </div>
              <div className={`cbd-amount ${isLeading?"leading-amount":""}`}>{fmt(st.curBid)}</div>
              {!isLeading&&st.curBidder!==null&&leadTeam&&(
                <div className="cbd-leader" style={{background:`${leadTeam.color}22`,color:leadTeam.color}}>
                  ⚠ {leadTeam.name} is leading!
                </div>
              )}
              {isLeading&&(
                <div className="cbd-leader" style={{background:"rgba(0,255,136,.12)",color:"var(--ok)"}}>
                  ✓ Your bid is highest — raise if needed!
                </div>
              )}
            </div>

            {/* BID BUTTON */}
            <button className="cbb"
              style={{background:isLeading?"linear-gradient(135deg,var(--ok),#00cc66)":"linear-gradient(135deg,var(--gold),#ff9900)"}}
              disabled={!canBid} onClick={()=>onBid(myTeam.id)}>
              {isLeading?`✓ LEADING  ${fmt(st.curBid)}`:canBid?`🔨 BID  ${fmt(nextBid)}`:"CANNOT BID"}
            </button>
            {!canBid&&!isLeading&&(
              <div style={{fontSize:10,color:"var(--mut)",marginTop:8}}>
                {myTeam.purse<nextBid?"⚠ Insufficient purse":squad.length>=MAX_SQUAD?"⚠ Squad full":myTeam.marqueeCount>=MAX_MARQUEE?"⚠ All slots used":"Bidding paused"}
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
            <div>Purse: <span style={{color:"var(--gold)",fontWeight:700}}>{fmt(myTeam.purse)}</span></div>
            <div>Spent: <span style={{color:"var(--cyan)",fontWeight:700}}>{fmt(PURSE-myTeam.purse)}</span></div>
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
          {" · "}Round {st.aRound}/{TOTAL_ROUNDS} · {soldCount}/{auctionPlayers.length} sold
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
          <div style={{display:"flex",justifyContent:"center",gap:7,marginBottom:14}}>
            <span className="ch">{curPlayer.role}</span>
            <span className="ch">{curPlayer.tier}</span>
          </div>
          {/* NO bid amount — show bidding status only */}
          <div style={{background:"rgba(0,0,0,.4)",border:"1px solid rgba(0,229,255,.15)",borderRadius:11,padding:16}}>
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
          {teams.map(t=>(<div key={t.id} style={{background:"rgba(255,255,255,.04)",borderRadius:9,padding:"10px 7px",textAlign:"center",
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
                {/* NO price for viewer */}
                <div style={{fontSize:9,color:"var(--mut)",background:"rgba(255,255,255,.05)",padding:"2px 7px",borderRadius:4}}>
                  {p.isCaptain?"Captain":p.round===0?"Pre-set":`R${p.round}`}
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
      <div className="pgg">
        {auctionPlayers.map(p=>{
          const sold=p.soldTo!==null?teams.find(t=>t.id===p.soldTo):undefined;
          return(<div key={p.id} className={`pc ${p.soldTo!==null?"sp":""}`}>
            <div className="pcav" style={{borderColor:tc(p.tier),background:`${tc(p.tier)}15`,color:tc(p.tier)}}>{p.img}</div>
            <div className="pcn">{p.name}</div><div className="pcr">{p.role}</div>
            <div className="pctb" style={{color:tc(p.tier)}}>{p.tier}</div>
            {/* NO price — team name only */}
            {sold?<div className="pcs">✓ {sold.name}</div>:<div className="pcb">Available</div>}
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
          <div style={{flex:1}}><div className="tfn" style={{color:team.color}}>{team.name}</div><div style={{fontSize:10,color:"var(--mut)"}}>Purse: {fmt(team.purse)}</div></div>
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
function DoneScreen({teams}:{teams:Team[]}){return(
  <div><div className="done"><div className="dtr">🏆</div><div className="dtl">PARSTRIKER AUCTION COMPLETE</div>
    <p style={{color:"var(--mut)",marginBottom:32}}>All {TOTAL_ROUNDS} rounds done · Final squads locked!</p>
  </div><div className="tgrid"><AdminTeamCards teams={teams}/></div><Footer/></div>
);}

// ─── FOOTER ───────────────────────────────────────────────────────────────────
function Footer(){return(<div className="ps-footer"><div className="ps-footer-txt">© 2025 <span>SKIRPANE</span> · All Rights Reserved</div></div>);}
