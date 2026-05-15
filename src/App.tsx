// src/App.tsx
import { useState, useEffect, useCallback } from "react";
import { initializeApp, FirebaseApp } from "firebase/app";
import { getDatabase, Database, ref, onValue, set, update, get } from "firebase/database";

// ─── FIREBASE LAZY INIT ───────────────────────────────────────────────────────
interface FBConfig {
  apiKey: string; authDomain: string; databaseURL: string;
  projectId: string; storageBucket: string; messagingSenderId: string; appId: string;
}
const FB_STORE_KEY = "ps_fb_config_v2";
const loadSavedConfig = (): FBConfig | null => {
  try { const r = localStorage.getItem(FB_STORE_KEY); return r ? JSON.parse(r) as FBConfig : null; }
  catch { return null; }
};
const saveConfig = (c: FBConfig) => { try { localStorage.setItem(FB_STORE_KEY, JSON.stringify(c)); } catch {} };
let _app: FirebaseApp | null = null;
let _db:  Database    | null = null;
const initFB = (cfg: FBConfig): Database => {
  if (!_app) { _app = initializeApp(cfg); _db = getDatabase(_app); }
  return _db!;
};
const getDb = (): Database => {
  if (_db) return _db;
  const c = loadSavedConfig();
  if (c) return initFB(c);
  throw new Error("Firebase not ready");
};
const fbRef  = ()  => ref(getDb(), "psAuction_v3");
const readSt = async (): Promise<AuctionState> => { const s = await get(fbRef()); return s.exists() ? s.val() as AuctionState : INIT_STATE; };
const writeSt= async (s: AuctionState) => set(fbRef(), s);
const patchSt= async (p: Partial<AuctionState>) => update(fbRef(), p);

// ─── TYPES ───────────────────────────────────────────────────────────────────
type Role  = "login" | "admin" | "captain" | "viewer";
type Phase = "banner" | "running" | "done";
interface SkillTier { basePrice: number; color: string; badge: string }
interface Player {
  id: number; name: string; role: string; tier: string;
  country: string; img: string; basePrice: number;
  soldTo: number | null; soldPrice: number | null; round: number | null;
}
interface SquadPlayer extends Player { soldPrice: number; isMarquee: boolean; round: number; }
interface Team {
  id: number; name: string; short: string; color: string; accent: string;
  captainPass: string; purse: number; squad: SquadPlayer[]; marqueeCount: number;
}
interface LogItem { icon: string; text: string; time: string; }
interface AuctionState {
  queue: number[]; curIdx: number; curBid: number; curBidder: number | null;
  aRound: number; phase: Phase; showSold: boolean; aDone: boolean;
  log: LogItem[]; teams: Team[]; players: Player[];
  dataVersion: number;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const PURSE        = 500;  // ₹500L per team
const MIN_BID      = 5;
const MAX_SQUAD    = 12;
const TOTAL_ROUNDS = 3;
const ADMIN_PASS   = "admin123";
const DATA_VERSION = 4;    // bump this whenever players/teams change to auto-reset stale DB

const TIERS: Record<string, SkillTier> = {
  "Star":     { basePrice: 100, color: "#FFD700", badge: "★★★" },
  "Pro":      { basePrice: 60,  color: "#00e5ff", badge: "★★"  },
  "Emerging": { basePrice: 20,  color: "#69ff47", badge: "★"   },
};
const TIER_ORDER = ["Star", "Pro", "Emerging"];

// ─── YOUR PLAYERS ─────────────────────────────────────────────────────────────
const RAW_PLAYERS = [
  { id:1,  name:"Abdul Mubeen",        role:"All-Rounder",              tier:"Emerging", img:"AM"   },
  { id:2,  name:"Amit Jadli",          role:"Batsman / WK",             tier:"Emerging", img:"AJ"   },
  { id:3,  name:"Anshul Dikshit",      role:"Batsman",                  tier:"Emerging", img:"AD"   },
  { id:4,  name:"Ashish Negeet",       role:"All-Rounder",              tier:"Emerging", img:"AN"   },
  { id:5,  name:"Janesh Chohan",       role:"All-Rounder",              tier:"Emerging", img:"JC"   },
  { id:6,  name:"Jitendra Mistry",     role:"Batsman",                  tier:"Emerging", img:"JM"   },
  { id:7,  name:"Kannan Santharam",    role:"All-Rounder",              tier:"Emerging", img:"KS"   },
  { id:8,  name:"Karthik Vempati",     role:"Batsman",                  tier:"Emerging", img:"KV"   },
  { id:9,  name:"Krunal Shah",         role:"All-Rounder",              tier:"Emerging", img:"KSh"  },
  { id:10, name:"Mahendra Negi",       role:"All-Rounder",              tier:"Emerging", img:"MN"   },
  { id:11, name:"Nikhil Surabhi",      role:"Batsman",                  tier:"Emerging", img:"NS"   },
  { id:12, name:"Pradeep Patil",       role:"Bowling All-Rounder",      tier:"Emerging", img:"PP"   },
  { id:13, name:"Pranay Raj",          role:"All-Rounder",              tier:"Emerging", img:"PR"   },
  { id:14, name:"Rajat Mehrotra",      role:"All-Rounder / WK",         tier:"Emerging", img:"RM"   },
  { id:15, name:"Sameer Saxena",       role:"Batsman",                  tier:"Emerging", img:"SS"   },
  { id:16, name:"Sandeep Kirpane",     role:"All-Rounder",              tier:"Emerging", img:"SK"   },
  { id:17, name:"Sanjay Prajapati",    role:"Bowler",                   tier:"Emerging", img:"SP"   },
  { id:18, name:"Sanket Rana",         role:"Batsman",                  tier:"Emerging", img:"SRa"  },
  { id:19, name:"Santosh Vaghmare",    role:"Bowling All-Rounder",      tier:"Emerging", img:"SV"   },
  { id:20, name:"Savan Paka",          role:"Batsman",                  tier:"Emerging", img:"SPa"  },
  { id:21, name:"Sushil Page",         role:"Batsman",                  tier:"Emerging", img:"SuP"  },
  { id:22, name:"Tushar More",         role:"Bowler",                   tier:"Emerging", img:"TM"   },
  { id:23, name:"Vikramjeet Sangavkar",role:"Batsman / WK",             tier:"Emerging", img:"VS"   },
  { id:24, name:"Vineet Shende",       role:"All-Rounder",              tier:"Emerging", img:"VSh"  },
  { id:25, name:"Srini Vellingiri",    role:"Batsman",                  tier:"Emerging", img:"SV2"  },
  { id:26, name:"Aravind Kaluva",      role:"Bowling All-Rounder",      tier:"Emerging", img:"AK"   },
  { id:27, name:"Raghav Ambati",       role:"Batting All-Rounder",      tier:"Emerging", img:"RA"   },
  { id:28, name:"Karan Shah",          role:"Bowling All-Rounder",      tier:"Emerging", img:"KSh2" },
  { id:29, name:"Vibhor",              role:"Batsman / WK",             tier:"Emerging", img:"VB"   },
];

const INIT_PLAYERS: Player[] = RAW_PLAYERS.map(p => ({
  ...p, country: "IND", basePrice: TIERS[p.tier].basePrice, soldTo: null, soldPrice: null, round: null,
}));

// ─── YOUR TEAMS ───────────────────────────────────────────────────────────────
const INIT_TEAMS: Team[] = [
  { id:1, name:"Blue Indians",  short:"BI", color:"#1565ff", accent:"#FFD700", captainPass:"ashish123",  purse:PURSE, squad:[], marqueeCount:0 },
  { id:2, name:"Red Knights",   short:"RK", color:"#ff2020", accent:"#FFD700", captainPass:"kannan123",  purse:PURSE, squad:[], marqueeCount:0 },
  { id:3, name:"White Wolves",  short:"WW", color:"#e0e0e0", accent:"#FFD700", captainPass:"sandeep123", purse:PURSE, squad:[], marqueeCount:0 },
];

const INIT_STATE: AuctionState = {
  queue:[], curIdx:0, curBid:0, curBidder:null,
  aRound:0, phase:"banner", showSold:false, aDone:false,
  log:[], teams:INIT_TEAMS, players:INIT_PLAYERS, dataVersion: DATA_VERSION,
};

// ─── UTILS ───────────────────────────────────────────────────────────────────
const fmt = (v: number): string => v >= 100 ? `₹${(v/100).toFixed(1)}Cr` : `₹${v}L`;
const tc  = (t: string): string =>
  ({ "Star":"#FFD700","Pro":"#00e5ff","Emerging":"#69ff47" }[t] ?? "#aaa");

// safe array helper — always returns array even if Firebase gave null
const safeArr = <T,>(a: T[] | null | undefined): T[] => Array.isArray(a) ? a : [];

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@500;700&family=DM+Sans:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#05050e;--s1:#0c0c1a;--s2:#12121f;--s3:#1a1a2e;--bd:#25253d;
  --gold:#FFD700;--cyan:#00e5ff;--green:#69ff47;--txt:#f0f0ff;--mut:#5555aa;
  --ok:#00ff88;--ng:#ff3355;--warn:#ff9900;
}
body{background:var(--bg);color:var(--txt);font-family:'DM Sans',sans-serif;min-height:100vh;overflow-x:hidden}

/* GLOW UTILS */
.glow-gold{box-shadow:0 0 18px rgba(255,215,0,.35)}
.glow-cyan{box-shadow:0 0 18px rgba(0,229,255,.3)}

/* SETUP SCREEN */
.setup-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;
  background:radial-gradient(ellipse at 20% 20%,rgba(0,229,255,.08) 0%,transparent 50%),
             radial-gradient(ellipse at 80% 80%,rgba(255,215,0,.07) 0%,transparent 50%),
             var(--bg)}
.setup-box{background:linear-gradient(145deg,#0f0f22,#0a0a18);border:1px solid rgba(0,229,255,.3);
  border-radius:20px;padding:32px 28px;width:100%;max-width:480px;
  box-shadow:0 0 40px rgba(0,229,255,.1)}
.setup-logo{font-family:'Bebas Neue';font-size:38px;letter-spacing:4px;
  background:linear-gradient(90deg,#FFD700,#00e5ff);-webkit-background-clip:text;
  -webkit-text-fill-color:transparent;background-clip:text;margin-bottom:2px}
.setup-sub{font-family:'Bebas Neue';font-size:16px;letter-spacing:3px;color:var(--mut);margin-bottom:20px}
.setup-desc{font-size:12px;color:var(--mut);line-height:1.7;margin-bottom:22px;
  background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.15);border-radius:10px;padding:12px 14px}
.setup-desc b{color:var(--cyan)}
.setup-field{margin-bottom:10px}
.setup-lbl{font-size:9px;color:var(--cyan);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:3px;display:block}
.setup-inp{width:100%;background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.2);
  border-radius:8px;padding:9px 12px;color:var(--txt);font-size:12px;outline:none;transition:all .2s}
.setup-inp:focus{border-color:var(--cyan);box-shadow:0 0 10px rgba(0,229,255,.15)}
.setup-err{background:rgba(255,51,85,.12);border:1px solid rgba(255,51,85,.4);border-radius:8px;
  padding:8px 12px;font-size:11px;color:var(--ng);margin-bottom:10px}
.setup-btn{width:100%;margin-top:14px;padding:14px;
  background:linear-gradient(135deg,var(--gold),var(--cyan));
  border:none;border-radius:11px;color:#000;font-family:'Bebas Neue';font-size:19px;
  letter-spacing:3px;cursor:pointer;transition:all .25s;font-weight:900}
.setup-btn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(255,215,0,.3)}

/* CONNECTING */
.conn{min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;
  background:var(--bg)}
.spin{width:44px;height:44px;border:3px solid rgba(0,229,255,.15);border-top-color:var(--cyan);
  border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* HEADER */
.hdr{background:linear-gradient(90deg,#05050e,#0a0520,#05050e);border-bottom:1px solid rgba(0,229,255,.15);
  padding:10px 18px;display:flex;align-items:center;justify-content:space-between;
  position:sticky;top:0;z-index:200;backdrop-filter:blur(20px)}
.hl{font-family:'Bebas Neue';font-size:20px;letter-spacing:3px;
  background:linear-gradient(90deg,var(--gold),var(--cyan));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hl-sub{font-size:10px;color:var(--mut);letter-spacing:2px;font-family:'Rajdhani'}
.hr{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rp{padding:3px 11px;border-radius:20px;font-size:9px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;border:1px solid}
.xb{background:transparent;border:1px solid var(--bd);color:var(--mut);padding:5px 12px;
  border-radius:7px;cursor:pointer;font-size:11px;transition:all .2s}
.xb:hover{border-color:var(--ng);color:var(--ng)}
.nb{background:transparent;border:1px solid var(--ng);color:var(--ng);padding:5px 12px;
  border-radius:7px;cursor:pointer;font-size:11px}

/* NAV */
.nav{background:rgba(0,0,0,.4);border-bottom:1px solid var(--bd);padding:0 18px;
  display:flex;gap:2px;overflow-x:auto;backdrop-filter:blur(10px)}
.nt{background:transparent;border:none;color:var(--mut);padding:12px 14px;cursor:pointer;
  font-family:'Rajdhani';font-weight:700;font-size:12px;letter-spacing:1px;
  border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap}
.nt:hover{color:var(--txt)}
.nt.on{color:var(--gold);border-bottom-color:var(--gold)}

/* LOGIN */
.lw{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;
  background:radial-gradient(ellipse at 25% 25%,rgba(255,215,0,.06),transparent 50%),
             radial-gradient(ellipse at 75% 75%,rgba(0,229,255,.06),transparent 50%),var(--bg)}
.lb{background:linear-gradient(145deg,#0f0f22,#0a0a18);border:1px solid rgba(255,215,0,.2);
  border-radius:22px;padding:38px 32px;width:100%;max-width:400px;text-align:center;
  box-shadow:0 0 50px rgba(255,215,0,.08)}
.ll{font-family:'Bebas Neue';font-size:38px;letter-spacing:4px;margin-bottom:2px;
  background:linear-gradient(90deg,var(--gold),var(--cyan));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.ls{color:var(--mut);font-size:12px;margin-bottom:28px;letter-spacing:.5px}
.rg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px}
.rb{background:rgba(255,255,255,.03);border:1px solid var(--bd);border-radius:12px;
  padding:14px 8px;cursor:pointer;transition:all .2s;color:var(--txt);text-align:center}
.rb:hover{border-color:rgba(255,215,0,.4);background:rgba(255,215,0,.04)}
.rb.sel{border-color:var(--gold);background:rgba(255,215,0,.07);box-shadow:0 0 12px rgba(255,215,0,.15)}
.ri{font-size:24px;margin-bottom:5px}
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
.em{color:var(--ng);font-size:11px;margin-bottom:8px;
  background:rgba(255,51,85,.1);border:1px solid rgba(255,51,85,.3);
  border-radius:7px;padding:7px 10px}
.ht{margin-top:12px;font-size:10px;color:var(--mut);line-height:1.8}
.ht b{color:var(--cyan)}

/* ROUND BANNER */
.rbn{text-align:center;padding:40px 24px;max-width:600px;margin:0 auto}
.rbe{font-family:'Rajdhani';font-size:11px;letter-spacing:4px;color:var(--mut);text-transform:uppercase;margin-bottom:8px}
.rbt{font-family:'Bebas Neue';font-size:56px;letter-spacing:5px;margin-bottom:10px;
  background:linear-gradient(90deg,var(--gold),var(--cyan));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.rbd{color:var(--mut);font-size:13px;margin-bottom:28px;line-height:1.7}
.rbb{padding:15px 44px;background:linear-gradient(135deg,var(--gold),#ff9900);
  border:none;border-radius:12px;color:#000;font-family:'Bebas Neue';font-size:22px;
  letter-spacing:3px;cursor:pointer;transition:all .25s;font-weight:900}
.rbb:hover{transform:translateY(-3px);box-shadow:0 10px 30px rgba(255,215,0,.4)}

/* TEAM CARDS (banner/teams view) */
.tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;
  padding:16px;max-width:1000px;margin:0 auto}
.tfc{border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.08);
  background:linear-gradient(145deg,var(--s2),var(--s1));transition:all .3s}
.tfc:hover{transform:translateY(-3px)}
.tfh{padding:14px 16px;display:flex;justify-content:space-between;align-items:center;position:relative;overflow:hidden}
.tfh::before{content:'';position:absolute;inset:0;opacity:.12}
.team-logo{width:52px;height:52px;border-radius:50%;display:flex;align-items:center;
  justify-content:center;font-family:'Bebas Neue';font-size:16px;letter-spacing:1px;
  border:2px solid;font-weight:900;flex-shrink:0}
.tfn{font-family:'Bebas Neue';font-size:16px;letter-spacing:2px;flex:1;padding:0 10px}
.tfs{display:flex;gap:6px;padding:0 14px 12px}
.tv{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:7px;
  padding:7px 9px;flex:1;text-align:center}
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
.mq{font-size:7px;background:var(--gold);color:#000;padding:1px 3px;
  border-radius:2px;font-weight:700;letter-spacing:.5px;margin-left:3px}

/* AUCTION LAYOUT */
.al{display:grid;grid-template-columns:1fr 300px;min-height:calc(100vh - 108px)}
.stg{padding:18px;overflow-y:auto;
  background:radial-gradient(ellipse at 50% 0%,rgba(0,229,255,.05),transparent 60%),var(--bg)}
.st{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px}
.rpill{padding:4px 12px;border-radius:20px;font-family:'Rajdhani';font-weight:700;font-size:11px;
  letter-spacing:1px;background:rgba(255,215,0,.1);color:var(--gold);border:1px solid rgba(255,215,0,.3)}
.pb{background:rgba(255,255,255,.08);border-radius:4px;height:4px;width:140px;margin-top:4px}
.pf{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--gold),var(--cyan));transition:width .5s}

/* SPOTLIGHT */
.spl{background:linear-gradient(145deg,rgba(0,229,255,.05),rgba(255,215,0,.03));
  border:1px solid rgba(0,229,255,.2);border-radius:20px;padding:24px;
  text-align:center;margin-bottom:14px;position:relative;overflow:hidden}
.spl::before{content:'';position:absolute;top:-40%;left:-20%;width:140%;height:140%;
  background:radial-gradient(ellipse,rgba(255,215,0,.04),transparent 55%);pointer-events:none}
.tt{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.05);
  border-radius:20px;padding:4px 12px;margin-bottom:12px;font-size:10px;font-weight:700;
  letter-spacing:1.5px;border:1px solid}
.pav{width:80px;height:80px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:'Bebas Neue';font-size:20px;margin:0 auto 10px;border:3px solid}
.pn{font-family:'Bebas Neue';font-size:34px;letter-spacing:3px;line-height:1;margin-bottom:8px}
.pm{display:flex;justify-content:center;gap:7px;margin-bottom:14px;flex-wrap:wrap}
.ch{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
  border-radius:14px;padding:3px 10px;font-size:11px;color:var(--txt)}

/* BID BOX */
.bb{background:rgba(0,0,0,.4);border:1px solid rgba(255,215,0,.15);
  border-radius:12px;padding:14px;margin-bottom:14px}
.bl{font-size:9px;color:var(--mut);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:2px}
.ba{font-family:'Bebas Neue';font-size:46px;letter-spacing:2px;line-height:1;
  background:linear-gradient(90deg,var(--gold),#ff9900);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.bs{font-size:11px;color:var(--mut);margin-top:2px}
.bldr{font-family:'Rajdhani';font-size:13px;font-weight:700;margin-top:5px}

/* BID BUTTONS */
.bg{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:9px}
.tbb{padding:10px 7px;border-radius:10px;border:2px solid;cursor:pointer;
  font-family:'Rajdhani';font-weight:700;font-size:11px;transition:all .2s;text-align:left}
.tbb:disabled{opacity:.25;cursor:not-allowed}
.tbb:not(:disabled):hover{transform:translateY(-2px)}
.tdg{font-family:'Bebas Neue';font-size:11px;letter-spacing:1.5px;padding:2px 5px;border-radius:3px}

/* ACTION BUTTONS */
.ar{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.sdb{background:linear-gradient(135deg,var(--ok),#00cc66);border:none;border-radius:10px;
  color:#000;padding:12px;font-family:'Bebas Neue';font-size:18px;letter-spacing:2px;
  cursor:pointer;transition:all .2s;font-weight:900}
.sdb:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,255,136,.3)}
.sdb:disabled{opacity:.35;cursor:not-allowed}
.usb{background:transparent;border:2px solid var(--bd);border-radius:10px;
  color:var(--mut);padding:12px;font-family:'Bebas Neue';font-size:18px;letter-spacing:2px;
  cursor:pointer;transition:all .2s}
.usb:hover:not(:disabled){border-color:var(--ng);color:var(--ng)}
.usb:disabled{opacity:.35;cursor:not-allowed}

/* SOLD OVERLAY */
.so{position:absolute;inset:0;background:rgba(0,0,0,.9);display:flex;flex-direction:column;
  align-items:center;justify-content:center;border-radius:20px;z-index:10;animation:fi .3s ease}
.sot{font-family:'Bebas Neue';font-size:64px;letter-spacing:8px;color:var(--ok);
  animation:zi .4s ease;text-shadow:0 0 30px rgba(0,255,136,.5)}
.soto{font-size:14px;color:var(--mut);margin-top:3px}
.sop{font-family:'Bebas Neue';font-size:30px;
  background:linear-gradient(90deg,var(--gold),#ff9900);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes zi{from{transform:scale(.3) rotate(-5deg);opacity:0}to{transform:scale(1) rotate(0);opacity:1}}

/* SIDEBAR */
.sb{background:rgba(0,0,0,.5);border-left:1px solid var(--bd);overflow-y:auto;
  max-height:calc(100vh - 108px);backdrop-filter:blur(10px)}
.ss{padding:12px;border-bottom:1px solid var(--bd)}
.sbt{font-family:'Rajdhani';font-size:9px;font-weight:700;text-transform:uppercase;
  letter-spacing:2px;color:var(--mut);margin-bottom:10px}
.tc{background:rgba(255,255,255,.03);border-radius:9px;padding:10px;margin-bottom:6px;
  border:1px solid rgba(255,255,255,.06);transition:all .2s}
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

/* CAPTAIN VIEW */
.cw{max-width:760px;margin:0 auto;padding:14px}
.cst{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
.cs{background:linear-gradient(145deg,var(--s2),var(--s1));border:1px solid var(--bd);
  border-radius:10px;padding:11px;text-align:center}
.csv{font-family:'Bebas Neue';font-size:22px;letter-spacing:1px}
.csl{font-size:8px;color:var(--mut);text-transform:uppercase;letter-spacing:1px;margin-top:2px}
.curb{background:linear-gradient(145deg,var(--s2),var(--s1));border:2px solid var(--bd);
  border-radius:16px;padding:20px;text-align:center;transition:all .3s}
.curb.act{border-color:rgba(255,215,0,.5);box-shadow:0 0 24px rgba(255,215,0,.1)}
.nm{color:var(--mut);font-size:13px;padding:44px 0}
.cbb{width:100%;margin-top:12px;padding:16px;border:none;border-radius:12px;color:#000;
  font-family:'Bebas Neue';font-size:21px;letter-spacing:3px;cursor:pointer;transition:all .25s;font-weight:900}
.cbb:hover:not(:disabled){transform:translateY(-3px)}
.cbb:disabled{opacity:.32;cursor:not-allowed}

/* PLAYER POOL */
.pgw{padding:14px;max-width:1000px;margin:0 auto}
.fr{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}
.fb{background:rgba(255,255,255,.04);border:1px solid var(--bd);color:var(--mut);
  padding:4px 11px;border-radius:14px;cursor:pointer;font-size:11px;transition:all .2s}
.fb.on,.fb:hover{border-color:var(--gold);color:var(--gold);background:rgba(255,215,0,.06)}
.pgg{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:8px}
.pc{background:linear-gradient(145deg,var(--s2),var(--s1));border:1px solid rgba(255,255,255,.07);
  border-radius:11px;padding:12px;transition:all .2s}
.pc:hover{border-color:rgba(255,215,0,.2);transform:translateY(-2px)}
.pc.sp{opacity:.45}
.pcav{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:'Bebas Neue';font-size:10px;border:2px solid;margin-bottom:7px}
.pcn{font-family:'Rajdhani';font-weight:700;font-size:12px;margin-bottom:2px;line-height:1.2}
.pcr{font-size:9px;color:var(--mut);margin-bottom:5px;line-height:1.3}
.pctb{font-size:8px;padding:2px 6px;border-radius:7px;background:rgba(255,255,255,.06);display:inline-block}
.pcs{font-size:9px;color:var(--ok);font-weight:700;margin-top:4px}
.pcb{font-size:9px;color:var(--mut);margin-top:3px}

/* VIEWER */
.vtk{padding:8px 16px;display:flex;align-items:center;gap:9px;overflow:hidden;
  background:rgba(0,229,255,.05);border-bottom:1px solid rgba(0,229,255,.15)}
.vld{background:var(--ng);color:#fff;font-size:8px;font-weight:700;padding:2px 5px;
  border-radius:3px;letter-spacing:1px;animation:pulse 1.5s infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.vtxt{font-size:11px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* SQUAD GRID */
.sqg{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.sqc{background:linear-gradient(145deg,var(--s2),var(--s1));border:1px solid rgba(255,255,255,.07);
  border-radius:11px;padding:12px}

/* DONE */
.done{text-align:center;padding:40px 20px}
.dtr{font-size:66px;animation:bou 1s infinite alternate}
@keyframes bou{from{transform:translateY(0)}to{transform:translateY(-10px)}}
.dtl{font-family:'Bebas Neue';font-size:48px;letter-spacing:5px;margin:12px 0 6px;
  background:linear-gradient(90deg,var(--gold),var(--cyan));
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}

/* SYNCING TOAST */
.sync-toast{position:fixed;bottom:12px;right:12px;background:rgba(0,229,255,.12);
  border:1px solid rgba(0,229,255,.3);border-radius:8px;padding:6px 12px;
  font-size:11px;color:var(--cyan);z-index:999;backdrop-filter:blur(10px)}

::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-track{background:var(--s1)}
::-webkit-scrollbar-thumb{background:var(--bd);border-radius:3px}

@media(max-width:680px){
  .al{grid-template-columns:1fr}
  .sb{max-height:220px;border-left:none;border-top:1px solid var(--bd)}
  .pn{font-size:26px}.ba{font-size:34px}
  .bg{grid-template-columns:repeat(3,1fr)}
  .cst{grid-template-columns:repeat(2,1fr)}
  .nt{padding:10px 9px;font-size:11px}
  .lb{padding:28px 18px}
}
`;

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [fbReady, setFbReady] = useState<boolean>(() => loadSavedConfig() !== null);
  const [role,    setRole]    = useState<Role>("login");
  const [teamId,  setTeamId]  = useState<number | null>(null);
  const [st,      setSt]      = useState<AuctionState>(INIT_STATE);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    if (!fbReady) { setLoading(false); return; }
    let unsub: (() => void) | null = null;
    try {
      unsub = onValue(fbRef(), snap => {
        try {
          if (snap.exists()) {
            const raw = snap.val() as AuctionState;
            // If DB has old data version, reset it to fresh state
            if (!raw.dataVersion || raw.dataVersion < DATA_VERSION) {
              writeSt(INIT_STATE).catch(() => {});
              setSt(INIT_STATE);
            } else {
              // Sanitize all arrays to prevent "cannot read length of undefined"
              const safe: AuctionState = {
                ...INIT_STATE,
                ...raw,
                queue:   safeArr(raw.queue),
                log:     safeArr(raw.log),
                teams:   safeArr(raw.teams).map(t => ({ ...t, squad: safeArr(t.squad) })),
                players: safeArr(raw.players),
              };
              setSt(safe);
            }
          } else {
            writeSt(INIT_STATE).catch(() => {});
            setSt(INIT_STATE);
          }
        } catch { setSt(INIT_STATE); }
        setLoading(false);
      }, () => setLoading(false));
    } catch { setLoading(false); }
    return () => { unsub && unsub(); };
  }, [fbReady]);

  const addLog = (prev: AuctionState, icon: string, text: string): LogItem[] => {
    const time = new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
    return [{ icon, text, time }, ...safeArr(prev.log).slice(0, 59)];
  };

  const write = useCallback(async (next: AuctionState) => {
    setSaving(true);
    try { await writeSt(next); } catch(e) { console.error(e); }
    setSaving(false);
  }, []);

  const patch = useCallback(async (p: Partial<AuctionState>) => {
    setSaving(true);
    try { await patchSt(p); } catch(e) { console.error(e); }
    setSaving(false);
  }, []);

  // ── Auction actions ──
  const startRound = async (round: number) => {
    const snap = await readSt();
    const sorted = [...safeArr(snap.players)].sort((a,b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
    const queue  = round === 1 ? sorted.map(p=>p.id) : sorted.filter(p=>p.soldTo===null).map(p=>p.id);
    if (!queue.length) { alert("No unsold players left!"); return; }
    const first  = snap.players.find(p=>p.id===queue[0]);
    const log    = addLog(snap,"🎙️",`Round ${round} started! ${queue.length} players in pool.`);
    await write({ ...snap, queue, curIdx:0, curBid:first?.basePrice??0,
                  curBidder:null, aRound:round, phase:"running", showSold:false, log });
  };

  const placeBid = async (tid: number) => {
    const snap = await readSt();
    const cp   = safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[snap.curIdx]);
    if (!cp || snap.phase!=="running") return;
    const team = safeArr(snap.teams).find(t=>t.id===tid);
    if (!team) return;
    const nb = snap.curBidder!==null ? snap.curBid+MIN_BID : cp.basePrice;
    if (team.purse < nb) return;
    const log = addLog(snap,"💰",`${team.short} bid ${fmt(nb)} for ${cp.name}`);
    await patch({ curBid:nb, curBidder:tid, log } as Partial<AuctionState>);
  };

  const doSold = async () => {
    const snap = await readSt();
    if (snap.curBidder===null) return;
    const cp   = safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[snap.curIdx]);
    if (!cp) return;
    const team = safeArr(snap.teams).find(t=>t.id===snap.curBidder);
    if (!team) return;
    const isM  = cp.tier === "Star";
    const sp: SquadPlayer = { ...cp, soldPrice:snap.curBid, isMarquee:isM, round:snap.aRound };
    const newTeams = safeArr(snap.teams).map(t => t.id===snap.curBidder
      ? { ...t, purse:t.purse-snap.curBid, squad:[...safeArr(t.squad),sp], marqueeCount:isM?t.marqueeCount+1:t.marqueeCount }
      : t);
    const newPlayers = safeArr(snap.players).map(p =>
      p.id===cp.id ? { ...p, soldTo:snap.curBidder, soldPrice:snap.curBid, round:snap.aRound } : p);
    const log = addLog(snap,"🔨",`SOLD! ${cp.name} → ${team.short} for ${fmt(snap.curBid)}`);
    await write({ ...snap, teams:newTeams, players:newPlayers, showSold:true, log });
    setTimeout(() => advance(), 2100);
  };

  const doUnsold = async () => {
    const snap = await readSt();
    const cp   = safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[snap.curIdx]);
    if (!cp) return;
    const log  = addLog(snap,"❌",`${cp.name} UNSOLD (Round ${snap.aRound})`);
    await patch({ log } as Partial<AuctionState>);
    advance();
  };

  const advance = async () => {
    const snap = await readSt();
    const next = snap.curIdx + 1;
    if (next >= safeArr(snap.queue).length) {
      if (snap.aRound >= TOTAL_ROUNDS) {
        const log = addLog(snap,"🏆","All rounds complete! Parstriker Auction done!");
        await write({ ...snap, showSold:false, aDone:true, phase:"done", log });
      } else {
        const log = addLog(snap,"🔔",`Round ${snap.aRound} complete! Unsold players re-enter.`);
        await write({ ...snap, showSold:false, phase:"banner", log });
      }
    } else {
      const np = safeArr(snap.players).find(p=>p.id===safeArr(snap.queue)[next]);
      await patch({ curIdx:next, curBid:np?.basePrice??0, curBidder:null, showSold:false } as Partial<AuctionState>);
    }
  };

  const resetAll = async () => {
    if (!confirm("Reset ALL Parstriker auction data? Cannot be undone.")) return;
    await writeSt(INIT_STATE);
  };

  const logout = () => { setRole("login"); setTeamId(null); };

  // Derived
  const curPlayer  = safeArr(st.queue).length > 0 ? safeArr(st.players).find(p=>p.id===st.queue[st.curIdx]) : undefined;
  const leadTeam   = st.curBidder!==null ? safeArr(st.teams).find(t=>t.id===st.curBidder) : undefined;
  const soldCount  = safeArr(st.players).filter(p=>p.soldTo!==null).length;
  const progPct    = safeArr(st.queue).length > 0 ? Math.round((st.curIdx/st.queue.length)*100) : 0;
  const myTeam     = teamId!==null ? safeArr(st.teams).find(t=>t.id===teamId) : undefined;

  const canBid = useCallback((team: Team): boolean => {
    if (st.showSold || !curPlayer || st.phase!=="running") return false;
    if (safeArr(team.squad).length >= MAX_SQUAD) return false;
    const nb = st.curBidder!==null ? st.curBid+MIN_BID : curPlayer.basePrice;
    if (team.purse < nb) return false;
    if (team.id === st.curBidder) return false;
    return true;
  }, [st, curPlayer]);

  if (!fbReady) return (
    <>
      <style>{CSS}</style>
      <FirebaseSetup onSave={cfg => { saveConfig(cfg); initFB(cfg); setFbReady(true); setLoading(true); }} />
    </>
  );

  if (loading) return (
    <>
      <style>{CSS}</style>
      <div className="conn">
        <div className="spin" />
        <div style={{color:"var(--cyan)",fontSize:13,letterSpacing:1}}>Connecting to Parstriker…</div>
      </div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      {saving && <div className="sync-toast">⚡ Syncing…</div>}

      {role==="login" && (
        <LoginScreen teams={safeArr(st.teams)}
          onLogin={(r,tid) => { setRole(r); if(tid!==undefined) setTeamId(tid); }} />
      )}
      {role==="admin" && (
        <AdminView st={st} curPlayer={curPlayer} leadTeam={leadTeam}
          soldCount={soldCount} progPct={progPct}
          onBid={placeBid} onSold={doSold} onUnsold={doUnsold}
          onStartRound={startRound} onLogout={logout} onReset={resetAll} canBid={canBid} />
      )}
      {role==="captain" && myTeam && (
        <CaptainView myTeam={myTeam} st={st} curPlayer={curPlayer}
          onBid={placeBid} onLogout={logout} canBid={canBid(myTeam)} />
      )}
      {role==="viewer" && (
        <ViewerView st={st} curPlayer={curPlayer} leadTeam={leadTeam}
          soldCount={soldCount} onLogout={logout} />
      )}
    </>
  );
}

// ─── FIREBASE SETUP ───────────────────────────────────────────────────────────
function FirebaseSetup({ onSave }: { onSave: (c: FBConfig) => void }) {
  const [f, setF] = useState<FBConfig>({ apiKey:"",authDomain:"",databaseURL:"",projectId:"",storageBucket:"",messagingSenderId:"",appId:"" });
  const [err, setErr] = useState("");
  const fields: Array<{k: keyof FBConfig; lbl: string; ph: string}> = [
    {k:"apiKey",            lbl:"API Key",             ph:"AIzaSy..."},
    {k:"authDomain",        lbl:"Auth Domain",         ph:"xxx.firebaseapp.com"},
    {k:"databaseURL",       lbl:"Database URL ⚠️",     ph:"https://xxx-default-rtdb.firebaseio.com"},
    {k:"projectId",         lbl:"Project ID",          ph:"your-project-id"},
    {k:"storageBucket",     lbl:"Storage Bucket",      ph:"xxx.appspot.com"},
    {k:"messagingSenderId", lbl:"Messaging Sender ID", ph:"123456789"},
    {k:"appId",             lbl:"App ID",              ph:"1:123...:web:abc"},
  ];
  const save = () => {
    setErr("");
    for (const f2 of fields) if (!f[f2.k].trim()) { setErr(`Fill in: ${f2.lbl}`); return; }
    if (!f.databaseURL.startsWith("https://")) { setErr("Database URL must start with https://"); return; }
    onSave(f);
  };
  return (
    <div className="setup-wrap">
      <div className="setup-box">
        <div style={{textAlign:"center",marginBottom:20}}>
          <div className="setup-logo">🏏 PARSTRIKER</div>
          <div className="setup-sub">FIREBASE SETUP</div>
        </div>
        <div className="setup-desc">
          One-time setup per device.<br/>
          Go to <b>console.firebase.google.com</b> → ⚙️ Project Settings → Your apps → &lt;/&gt; Web → copy config
        </div>
        {err && <div className="setup-err">⚠ {err}</div>}
        {fields.map(({k,lbl,ph}) => (
          <div key={k} className="setup-field">
            <label className="setup-lbl">{lbl}</label>
            <input className="setup-inp" placeholder={ph} value={f[k]}
              onChange={e => setF(p=>({...p,[k]:e.target.value.trim()}))} />
          </div>
        ))}
        <button className="setup-btn" onClick={save}>🔥 CONNECT &amp; LAUNCH</button>
        <div style={{marginTop:12,fontSize:10,color:"var(--mut)",textAlign:"center",lineHeight:1.7}}>
          Config saved in browser · Each device enters once
        </div>
      </div>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({ teams, onLogin }: { teams: Team[]; onLogin: (r:Role,tid?:number)=>void }) {
  const [sel,  setSel]  = useState<Role|null>(null);
  const [pass, setPass] = useState("");
  const [err,  setErr]  = useState("");
  const tryLogin = () => {
    setErr("");
    if (!sel) return;
    if (sel==="viewer") { onLogin("viewer"); return; }
    if (sel==="admin")  { pass===ADMIN_PASS ? onLogin("admin") : setErr("Wrong admin password"); return; }
    const team = teams.find(t=>t.captainPass===pass);
    team ? onLogin("captain",team.id) : setErr("Wrong captain password");
  };
  return (
    <div className="lw">
      <div className="lb">
        <div className="ll">🏏 PARSTRIKER</div>
        <div className="ls">Select your role to enter</div>
        <div className="rg">
          {([["admin","🎙️","Admin","Full control"],["captain","👑","Captain","Bid players"],["viewer","👁️","Viewer","Watch live"]] as const).map(([r,ic,nm,hn])=>(
            <div key={r} className={`rb ${sel===r?"sel":""}`} onClick={()=>{setSel(r as Role);setPass("");setErr("");}}>
              <div className="ri">{ic}</div>
              <div className="rn">{nm}</div>
              <div className="rh">{hn}</div>
            </div>
          ))}
        </div>
        {err && <div className="em">⚠ {err}</div>}
        {sel && sel!=="viewer" && (
          <input className="inp" type="password"
            placeholder={sel==="admin"?"Admin password":"Captain password e.g. ashish123"}
            value={pass} onChange={e=>setPass(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&tryLogin()} />
        )}
        {sel==="viewer" && <div style={{fontSize:11,color:"var(--mut)",marginBottom:10}}>No password needed</div>}
        <button className="gb" disabled={!sel} onClick={tryLogin}>ENTER</button>
        <div className="ht">
          Admin: <b>admin123</b><br/>
          Captains: <b>ashish123</b> · <b>kannan123</b> · <b>sandeep123</b>
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
function AdminView({ st,curPlayer,leadTeam,soldCount,progPct,onBid,onSold,onUnsold,onStartRound,onLogout,onReset,canBid }:{
  st:AuctionState; curPlayer:Player|undefined; leadTeam:Team|undefined;
  soldCount:number; progPct:number;
  onBid:(id:number)=>void; onSold:()=>void; onUnsold:()=>void;
  onStartRound:(r:number)=>void; onLogout:()=>void; onReset:()=>void;
  canBid:(t:Team)=>boolean;
}) {
  const [tab,setTab]       = useState<"auction"|"players"|"teams">("auction");
  const [filter,setFilter] = useState("All");
  const teams   = safeArr(st.teams);
  const players = safeArr(st.players);

  return (
    <div>
      <div className="hdr">
        <div>
          <div className="hl">🏏 PARSTRIKER AUCTION</div>
          <div className="hl-sub">ADMIN CONTROL PANEL</div>
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

      {tab==="auction" && (
        st.aDone ? <DoneScreen teams={teams} /> :
        st.phase==="banner" ? (
          <div>
            <div className="rbn">
              <div className="rbe">{st.aRound===0?"WELCOME TO":"ROUND "+st.aRound+" COMPLETE"}</div>
              <div className="rbt">{st.aRound===0?"PARSTRIKER AUCTION":`ROUND ${st.aRound+1} OF ${TOTAL_ROUNDS}`}</div>
              <div className="rbd">
                {st.aRound===0
                  ? `${players.length} players · ${TOTAL_ROUNDS} rounds · ${teams.length} teams · Purse ${fmt(PURSE)} each`
                  : `${players.filter(p=>p.soldTo===null).length} unsold players re-enter`}
              </div>
              <button className="rbb" onClick={()=>onStartRound(st.aRound+1)}>
                {st.aRound===0?"⚡ START AUCTION":`▶ BEGIN ROUND ${st.aRound+1}`}
              </button>
            </div>
            <div className="tgrid"><TeamCards teams={teams}/></div>
          </div>
        ) : (
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

              {curPlayer && (
                <>
                  <div className="spl">
                    {st.showSold && (
                      <div className="so">
                        <div className="sot">SOLD!</div>
                        <div className="soto">to {leadTeam?.name??""}</div>
                        <div className="sop">{fmt(st.curBid)}</div>
                      </div>
                    )}
                    <div className="tt" style={{color:tc(curPlayer.tier),borderColor:`${tc(curPlayer.tier)}44`}}>
                      {TIERS[curPlayer.tier]?.badge} {curPlayer.tier}
                    </div>
                    <div className="pav" style={{borderColor:tc(curPlayer.tier),background:`${tc(curPlayer.tier)}15`,color:tc(curPlayer.tier)}}>
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
                      const able=canBid(team), isLead=team.id===st.curBidder;
                      const nb=st.curBidder!==null?st.curBid+MIN_BID:curPlayer.basePrice;
                      return (
                        <button key={team.id} className="tbb" disabled={!able}
                          style={{borderColor:isLead?team.color:"var(--bd)",background:isLead?`${team.color}22`:"var(--s2)",color:isLead?team.color:"var(--txt)"}}
                          onClick={()=>onBid(team.id)}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <span className="tdg" style={{background:`${team.color}22`,color:team.color}}>{team.short}</span>
                            {able&&<span style={{fontSize:9,color:"var(--gold)",fontFamily:"'Bebas Neue'"}}>{fmt(nb)}</span>}
                          </div>
                          <div style={{fontSize:8,opacity:.55,marginTop:2}}>{fmt(team.purse)}</div>
                          {isLead&&<div style={{fontSize:8,color:"var(--ok)",marginTop:1}}>● LEADING</div>}
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
                <div className="sbt">Purses</div>
                {teams.map(team=>{
                  const pct=(team.purse/PURSE)*100;
                  return (
                    <div key={team.id} className={`tc ${team.id===st.curBidder?"lead":""}`}>
                      <div className="tr">
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{width:20,height:20,borderRadius:"50%",background:team.color,
                            display:"flex",alignItems:"center",justifyContent:"center",
                            fontSize:7,fontWeight:700,color:"#000",flexShrink:0}}>{team.short[0]}</div>
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
                      <div style={{flex:1}}>
                        <div className="lt">{l.text}</div>
                        <div className="ltime">{l.time}</div>
                      </div>
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
              return (
                <div key={p.id} className={`pc ${p.soldTo!==null?"sp":""}`}>
                  <div className="pcav" style={{borderColor:tc(p.tier),background:`${tc(p.tier)}15`,color:tc(p.tier)}}>{p.img}</div>
                  <div className="pcn">{p.name}</div>
                  <div className="pcr">{p.role}</div>
                  <div className="pctb" style={{color:tc(p.tier)}}>{TIERS[p.tier]?.badge} {p.tier}</div>
                  {sold?<div className="pcs">✓ {sold.short} · {fmt(p.soldPrice??0)} · R{p.round}</div>
                       :<div className="pcb">Base: {fmt(p.basePrice)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab==="teams"&&<div className="tgrid"><TeamCards teams={teams}/></div>}
    </div>
  );
}

// ─── CAPTAIN ──────────────────────────────────────────────────────────────────
function CaptainView({ myTeam,st,curPlayer,onBid,onLogout,canBid }:{
  myTeam:Team; st:AuctionState; curPlayer:Player|undefined;
  onBid:(id:number)=>void; onLogout:()=>void; canBid:boolean;
}) {
  const [tab,setTab] = useState<"bid"|"squad"|"log">("bid");
  const isLeading = st.curBidder===myTeam.id;
  const pctLeft   = (myTeam.purse/PURSE)*100;
  const nextBid   = st.curBidder!==null ? st.curBid+MIN_BID : curPlayer?.basePrice??0;
  const myLogs    = safeArr(st.log).filter(l=>l.text.includes(myTeam.short));
  const squad     = safeArr(myTeam.squad);

  return (
    <div>
      <div className="hdr">
        <div>
          <div className="hl" style={{fontSize:18}}>
            <span style={{display:"inline-block",width:12,height:12,borderRadius:"50%",
              background:myTeam.color,marginRight:6,verticalAlign:"middle"}}/>
            {myTeam.name}
          </div>
          <div className="hl-sub">CAPTAIN DASHBOARD</div>
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
            <div className="cs">
              <div className="csv" style={{color:"var(--gold)"}}>{fmt(myTeam.purse)}</div>
              <div className="csl">Purse Left</div>
              <div style={{background:"rgba(255,255,255,.08)",borderRadius:3,height:3,marginTop:5}}>
                <div style={{height:"100%",borderRadius:3,background:pctLeft<20?"var(--ng)":myTeam.color,width:`${pctLeft}%`,transition:"width .5s"}}/>
              </div>
            </div>
            <div className="cs"><div className="csv">{squad.length}/{MAX_SQUAD}</div><div className="csl">Squad</div></div>
            <div className="cs"><div className="csv" style={{color:"var(--warn)"}}>{st.aRound>0?`R${st.aRound}`:"—"}</div><div className="csl">Round</div></div>
            <div className="cs"><div className="csv" style={{color:st.phase==="running"?"var(--ok)":"var(--mut)"}}>
              {st.phase==="running"?"●":st.phase==="done"?"✓":"○"}</div><div className="csl">Status</div></div>
          </div>

          <div className={`curb ${st.phase==="running"&&curPlayer?"act":""}`}>
            {st.phase==="banner"&&<div className="nm">⏳ Waiting for admin to start…</div>}
            {st.phase==="done"&&<div className="nm">🏆 Auction complete! Check your squad.</div>}
            {st.phase==="running"&&!curPlayer&&<div className="nm">Loading next player…</div>}
            {st.phase==="running"&&curPlayer&&(
              <>
                <div className="tt" style={{color:tc(curPlayer.tier),borderColor:`${tc(curPlayer.tier)}44`,
                  border:"1px solid",display:"inline-flex",alignItems:"center",gap:5,
                  padding:"4px 12px",borderRadius:20,marginBottom:12,fontSize:10,fontWeight:700,letterSpacing:1.5}}>
                  {TIERS[curPlayer.tier]?.badge} {curPlayer.tier}
                </div>
                <div style={{width:72,height:72,borderRadius:"50%",display:"flex",alignItems:"center",
                  justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:16,margin:"0 auto 9px",
                  border:`3px solid ${tc(curPlayer.tier)}`,background:`${tc(curPlayer.tier)}15`,color:tc(curPlayer.tier)}}>
                  {curPlayer.img}
                </div>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:30,letterSpacing:2,marginBottom:7,lineHeight:1.1}}>
                  {curPlayer.name}
                </div>
                <div style={{display:"flex",justifyContent:"center",gap:7,marginBottom:12,flexWrap:"wrap"}}>
                  <span className="ch">{curPlayer.role}</span>
                  <span className="ch">Base {fmt(curPlayer.basePrice)}</span>
                </div>
                <div style={{background:"rgba(0,0,0,.4)",border:"1px solid rgba(255,215,0,.15)",borderRadius:11,padding:13,marginBottom:4}}>
                  <div style={{fontSize:9,color:"var(--mut)",textTransform:"uppercase",letterSpacing:1.5,marginBottom:2}}>
                    {isLeading?"🔥 YOU ARE LEADING":st.curBidder!==null?"Bid in Progress":"Opening Price"}
                  </div>
                  <div style={{fontFamily:"'Bebas Neue'",fontSize:42,lineHeight:1,
                    background:isLeading?"linear-gradient(90deg,var(--ok),#00cc66)":"linear-gradient(90deg,var(--gold),#ff9900)",
                    WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>
                    {fmt(st.curBid)}
                  </div>
                  {!isLeading&&st.curBidder!==null&&(
                    <div style={{fontSize:11,color:"var(--ng)",marginTop:3}}>⚠ Another team is leading!</div>
                  )}
                </div>
                <button className="cbb"
                  style={{background:isLeading?"linear-gradient(135deg,var(--ok),#00cc66)":"linear-gradient(135deg,var(--gold),#ff9900)"}}
                  disabled={!canBid} onClick={()=>onBid(myTeam.id)}>
                  {isLeading?`✓ LEADING ${fmt(st.curBid)}`:canBid?`BID ${fmt(nextBid)}`:"CANNOT BID"}
                </button>
                {!canBid&&!isLeading&&(
                  <div style={{fontSize:10,color:"var(--mut)",marginTop:6}}>
                    {myTeam.purse<nextBid?"⚠ Insufficient purse":
                     squad.length>=MAX_SQUAD?"⚠ Squad full":"Bidding paused"}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab==="squad"&&(
        <div className="cw">
          <div style={{marginBottom:12}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2}}>{myTeam.name} Squad</div>
            <div style={{fontSize:11,color:"var(--mut)"}}>
              {squad.length} players · Spent: {fmt(PURSE-myTeam.purse)} · Remaining: {fmt(myTeam.purse)}
            </div>
          </div>
          {squad.length===0
            ?<div style={{color:"var(--mut)",textAlign:"center",padding:"50px 0"}}>No players acquired yet</div>
            :<div className="sqg">
              {squad.map(p=>(
                <div key={p.id} className="sqc">
                  <div style={{width:38,height:38,borderRadius:"50%",display:"flex",alignItems:"center",
                    justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:9,border:`2px solid ${tc(p.tier)}`,
                    background:`${tc(p.tier)}15`,color:tc(p.tier),marginBottom:7}}>{p.img}</div>
                  <div style={{fontFamily:"'Rajdhani'",fontWeight:700,fontSize:12,marginBottom:2,lineHeight:1.2}}>
                    {p.name}
                  </div>
                  <div style={{fontSize:9,color:"var(--mut)",marginBottom:4,lineHeight:1.3}}>{p.role}</div>
                  <div style={{fontFamily:"'Rajdhani'",fontWeight:700,fontSize:11,color:"var(--gold)"}}>{fmt(p.soldPrice)} · R{p.round}</div>
                </div>
              ))}
            </div>}
        </div>
      )}

      {tab==="log"&&(
        <div className="cw">
          <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2,marginBottom:12}}>My Activity</div>
          {myLogs.length===0
            ?<div style={{color:"var(--mut)",textAlign:"center",padding:"50px 0"}}>No activity for {myTeam.short} yet</div>
            :myLogs.map((l,i)=>(
              <div key={i} style={{display:"flex",gap:9,padding:"9px 0",borderBottom:"1px solid rgba(255,255,255,.05)"}}>
                <span style={{fontSize:16}}>{l.icon}</span>
                <div>
                  <div style={{fontSize:12}}>{l.text}</div>
                  <div style={{fontSize:9,color:"var(--mut)"}}>{l.time}</div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── VIEWER ───────────────────────────────────────────────────────────────────
function ViewerView({ st,curPlayer,leadTeam,soldCount,onLogout }:{
  st:AuctionState; curPlayer:Player|undefined; leadTeam:Team|undefined;
  soldCount:number; onLogout:()=>void;
}) {
  const [tab,setTab] = useState<"live"|"teams"|"players">("live");
  const teams   = safeArr(st.teams);
  const players = safeArr(st.players);

  return (
    <div>
      <div className="hdr">
        <div>
          <div className="hl">🏏 PARSTRIKER AUCTION</div>
          <div className="hl-sub">LIVE VIEWER</div>
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
            {" · "}Bid: <b style={{color:"var(--gold)"}}>{fmt(st.curBid)}</b>
            {leadTeam&&<span> · <b style={{color:leadTeam.color}}>{leadTeam.name}</b> leading</span>}
            {" · "}Round {st.aRound}/{TOTAL_ROUNDS} · Sold: {soldCount}/{players.length}
          </span>
        </div>
      )}

      <div className="nav">
        <button className={`nt ${tab==="live"?"on":""}`}    onClick={()=>setTab("live")}>📡 LIVE STAGE</button>
        <button className={`nt ${tab==="teams"?"on":""}`}   onClick={()=>setTab("teams")}>🏆 TEAMS</button>
        <button className={`nt ${tab==="players"?"on":""}`} onClick={()=>setTab("players")}>🏏 PLAYERS</button>
      </div>

      {tab==="live"&&(
        <div style={{padding:"14px",maxWidth:480,margin:"0 auto"}}>
          {st.phase!=="running"?(
            <div style={{textAlign:"center",padding:"70px 20px",color:"var(--mut)"}}>
              <div style={{fontSize:44,marginBottom:14}}>{st.phase==="done"?"🏆":"⏳"}</div>
              <div style={{fontSize:14}}>{st.phase==="done"?"Parstriker Auction complete!":"Auction hasn't started yet."}</div>
            </div>
          ):curPlayer?(
            <>
              <div className="spl" style={{marginBottom:14}}>
                <div className="tt" style={{color:tc(curPlayer.tier),borderColor:`${tc(curPlayer.tier)}44`,
                  border:"1px solid",display:"inline-flex",gap:5,padding:"4px 12px",borderRadius:20,
                  marginBottom:12,fontSize:10,fontWeight:700,letterSpacing:1.5}}>
                  {TIERS[curPlayer.tier]?.badge} {curPlayer.tier}
                </div>
                <div style={{width:72,height:72,borderRadius:"50%",display:"flex",alignItems:"center",
                  justifyContent:"center",fontFamily:"'Bebas Neue'",fontSize:16,margin:"0 auto 9px",
                  border:`3px solid ${tc(curPlayer.tier)}`,background:`${tc(curPlayer.tier)}15`,color:tc(curPlayer.tier)}}>
                  {curPlayer.img}
                </div>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:32,letterSpacing:3,marginBottom:7,lineHeight:1.1}}>
                  {curPlayer.name}
                </div>
                <div style={{display:"flex",justifyContent:"center",gap:7,marginBottom:14,flexWrap:"wrap"}}>
                  <span className="ch">{curPlayer.role}</span>
                  <span className="ch">Base {fmt(curPlayer.basePrice)}</span>
                </div>
                <div style={{background:"rgba(0,0,0,.4)",border:"1px solid rgba(255,215,0,.15)",borderRadius:11,padding:14}}>
                  <div style={{fontSize:9,color:"var(--mut)",textTransform:"uppercase",letterSpacing:1.5,marginBottom:2}}>Current Bid</div>
                  <div style={{fontFamily:"'Bebas Neue'",fontSize:46,lineHeight:1,
                    background:"linear-gradient(90deg,var(--gold),#ff9900)",
                    WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>
                    {fmt(st.curBid)}
                  </div>
                  {leadTeam&&<div style={{fontFamily:"'Rajdhani'",fontWeight:700,fontSize:14,marginTop:5,color:leadTeam.color}}>
                    🔥 {leadTeam.name}
                  </div>}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
                {teams.map(t=>(
                  <div key={t.id} style={{background:"rgba(255,255,255,.04)",borderRadius:9,padding:"9px 7px",textAlign:"center",
                    border:`1px solid ${t.id===leadTeam?.id?t.color:"rgba(255,255,255,.07)"}`,transition:"all .3s",
                    boxShadow:t.id===leadTeam?.id?`0 0 12px ${t.color}44`:"none"}}>
                    <div style={{width:24,height:24,borderRadius:"50%",background:t.color,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:9,fontWeight:700,color:"#000",margin:"0 auto 5px"}}>{t.short[0]}</div>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:12,color:t.color,letterSpacing:1}}>{t.short}</div>
                    <div style={{fontSize:10,color:"var(--gold)",fontWeight:600}}>{fmt(t.purse)}</div>
                    <div style={{fontSize:8,color:"var(--mut)"}}>{safeArr(t.squad).length}pl</div>
                  </div>
                ))}
              </div>
            </>
          ):null}
        </div>
      )}

      {tab==="teams"&&<div className="tgrid"><TeamCards teams={teams}/></div>}

      {tab==="players"&&(
        <div className="pgw">
          <div style={{marginBottom:10}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:24,letterSpacing:2}}>All Players</div>
            <div style={{fontSize:11,color:"var(--mut)"}}>{soldCount} sold · {players.length-soldCount} available</div>
          </div>
          <div className="pgg">
            {players.map(p=>{
              const sold=p.soldTo!==null?teams.find(t=>t.id===p.soldTo):undefined;
              return (
                <div key={p.id} className={`pc ${p.soldTo!==null?"sp":""}`}>
                  <div className="pcav" style={{borderColor:tc(p.tier),background:`${tc(p.tier)}15`,color:tc(p.tier)}}>{p.img}</div>
                  <div className="pcn">{p.name}</div>
                  <div className="pcr">{p.role}</div>
                  <div className="pctb" style={{color:tc(p.tier)}}>{TIERS[p.tier]?.badge} {p.tier}</div>
                  {sold?<div className="pcs">✓ {sold.short} · {fmt(p.soldPrice??0)}</div>
                       :<div className="pcb">Base: {fmt(p.basePrice)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TEAM CARDS (shared) ──────────────────────────────────────────────────────
function TeamCards({ teams }: { teams: Team[] }) {
  return (
    <>
      {teams.map(team=>{
        const squad = safeArr(team.squad);
        // Team logo background gradient
        const grad = `linear-gradient(135deg,${team.color}dd,${team.color}88)`;
        return (
          <div key={team.id} className="tfc">
            <div className="tfh" style={{borderBottom:`3px solid ${team.color}`}}>
              <div style={{position:"absolute",inset:0,background:grad,opacity:.1}}/>
              <div className="team-logo" style={{background:grad,borderColor:team.color,color:"#000"}}>
                {team.short}
              </div>
              <div className="tfn" style={{color:team.color}}>{team.name}</div>
              <div style={{textAlign:"right"}}>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:16,color:"var(--gold)"}}>{fmt(team.purse)}</div>
                <div style={{fontSize:9,color:"var(--mut)"}}>remaining</div>
              </div>
            </div>
            <div className="tfs">
              <div className="tv">
                <div className="tvv" style={{color:"var(--gold)"}}>{fmt(team.purse)}</div>
                <div className="tvl">Purse</div>
              </div>
              <div className="tv">
                <div className="tvv">{squad.length}/{MAX_SQUAD}</div>
                <div className="tvl">Players</div>
              </div>
              <div className="tv">
                <div className="tvv">{fmt(PURSE-team.purse)}</div>
                <div className="tvl">Spent</div>
              </div>
            </div>
            <div className="tfl">
              {squad.length===0&&<div style={{color:"var(--mut)",fontSize:10,padding:"5px 0"}}>No players yet</div>}
              {squad.map(p=>(
                <div key={p.id} className="tpr">
                  <div className="tpa" style={{borderColor:tc(p.tier),background:`${tc(p.tier)}15`,color:tc(p.tier)}}>
                    {p.img.slice(0,2)}
                  </div>
                  <div className="tpi">
                    <div className="tpn">{p.name}</div>
                    <div className="tps">{p.role} · R{p.round}</div>
                  </div>
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

// ─── DONE SCREEN ──────────────────────────────────────────────────────────────
function DoneScreen({ teams }: { teams: Team[] }) {
  return (
    <div>
      <div className="done">
        <div className="dtr">🏆</div>
        <div className="dtl">PARSTRIKER AUCTION COMPLETE</div>
        <p style={{color:"var(--mut)",marginBottom:32}}>All {TOTAL_ROUNDS} rounds done · Final squads locked!</p>
      </div>
      <div className="tgrid"><TeamCards teams={teams}/></div>
    </div>
  );
}
