// src/App.tsx
import { useState, useEffect, useCallback } from "react";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  onValue,
  set,
  update,
  get,
} from "firebase/database";

// ─── FIREBASE CONFIG ──────────────────────────────────────────────────────────
// Replace these values with YOUR Firebase project config
// Get them: console.firebase.google.com → Project Settings → Your apps → </> Web
// Import the functions you need from the SDKs you need

const firebaseConfig = {
  apiKey: "AIzaSyD3k2c_0oX3C3f1nAqDRYidKYNCGJgF7I4",
  authDomain: "parstriker-auction.firebaseapp.com",
  databaseURL: "https://parstriker-auction-default-rtdb.firebaseio.com",
  projectId: "parstriker-auction",
  storageBucket: "parstriker-auction.firebasestorage.app",
  messagingSenderId: "1400458016",
  appId: "1:1400458016:web:b19f0b8d854f5a9df02545",
  measurementId: "G-K3DN5P60EC"
};

// ─── TYPES ───────────────────────────────────────────────────────────────────
type Role  = "login" | "admin" | "captain" | "viewer";
type Phase = "banner" | "running" | "done";

interface SkillTier { basePrice: number; color: string; badge: string }

interface Player {
  id: number; name: string; role: string; tier: string;
  country: string; img: string; basePrice: number;
  soldTo: number | null; soldPrice: number | null; round: number | null;
}

interface SquadPlayer extends Player {
  soldPrice: number; isMarquee: boolean; round: number;
}

interface Team {
  id: number; name: string; short: string; color: string;
  captainPass: string; purse: number;
  squad: SquadPlayer[]; marqueeCount: number;
}

interface AuctionState {
  queue:      number[];
  curIdx:     number;
  curBid:     number;
  curBidder:  number | null;
  aRound:     number;
  phase:      Phase;
  showSold:   boolean;
  aDone:      boolean;
  log:        LogItem[];
  teams:      Team[];
  players:    Player[];
}

interface LogItem { icon: string; text: string; time: string }

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const PURSE        = 1000;
const MIN_BID      = 5;
const MAX_MARQUEE  = 8;
const MAX_SQUAD    = 15;
const TOTAL_ROUNDS = 3;
const ADMIN_PASS   = "admin123";
const FB_KEY       = "psAuctionState"; // Firebase root key

const TIERS: Record<string, SkillTier> = {
  "World Class":   { basePrice: 200, color: "#FFD700", badge: "★★★" },
  "International": { basePrice: 100, color: "#C0C0C0", badge: "★★"  },
  "Domestic Star": { basePrice: 50,  color: "#CD7F32", badge: "★"   },
  "Emerging":      { basePrice: 20,  color: "#4fc3f7", badge: "◆"   },
};
const TIER_ORDER = ["World Class", "International", "Domestic Star", "Emerging"];

const RAW_PLAYERS = [
  { id:1,  name:"Virat Kohli",       role:"Batsman",     tier:"World Class",   country:"IND", img:"VK"  },
  { id:2,  name:"Rohit Sharma",      role:"Batsman",     tier:"World Class",   country:"IND", img:"RS"  },
  { id:3,  name:"Jasprit Bumrah",    role:"Bowler",      tier:"World Class",   country:"IND", img:"JB"  },
  { id:4,  name:"Jos Buttler",       role:"WK-Batsman",  tier:"World Class",   country:"ENG", img:"JBu" },
  { id:5,  name:"Pat Cummins",       role:"All-Rounder", tier:"World Class",   country:"AUS", img:"PC"  },
  { id:6,  name:"Babar Azam",        role:"Batsman",     tier:"World Class",   country:"PAK", img:"BA"  },
  { id:7,  name:"Ben Stokes",        role:"All-Rounder", tier:"World Class",   country:"ENG", img:"BS"  },
  { id:8,  name:"Kane Williamson",   role:"Batsman",     tier:"World Class",   country:"NZ",  img:"KW"  },
  { id:9,  name:"Shreyas Iyer",      role:"Batsman",     tier:"International", country:"IND", img:"SI"  },
  { id:10, name:"Suryakumar Yadav",  role:"Batsman",     tier:"International", country:"IND", img:"SKY" },
  { id:11, name:"Ravindra Jadeja",   role:"All-Rounder", tier:"International", country:"IND", img:"RJ"  },
  { id:12, name:"Mohammed Shami",    role:"Bowler",      tier:"International", country:"IND", img:"MS"  },
  { id:13, name:"Glenn Maxwell",     role:"All-Rounder", tier:"International", country:"AUS", img:"GM"  },
  { id:14, name:"Quinton de Kock",   role:"WK-Batsman",  tier:"International", country:"SA",  img:"QDK" },
  { id:15, name:"Trent Boult",       role:"Bowler",      tier:"International", country:"NZ",  img:"TB"  },
  { id:16, name:"Rashid Khan",       role:"Bowler",      tier:"International", country:"AFG", img:"RK"  },
  { id:17, name:"David Warner",      role:"Batsman",     tier:"International", country:"AUS", img:"DW"  },
  { id:18, name:"Shubman Gill",      role:"Batsman",     tier:"International", country:"IND", img:"SG"  },
  { id:19, name:"Prithvi Shaw",      role:"Batsman",     tier:"Domestic Star", country:"IND", img:"PS"  },
  { id:20, name:"Ishan Kishan",      role:"WK-Batsman",  tier:"Domestic Star", country:"IND", img:"IK"  },
  { id:21, name:"Shardul Thakur",    role:"All-Rounder", tier:"Domestic Star", country:"IND", img:"ST"  },
  { id:22, name:"Axar Patel",        role:"All-Rounder", tier:"Domestic Star", country:"IND", img:"AP"  },
  { id:23, name:"Arshdeep Singh",    role:"Bowler",      tier:"Domestic Star", country:"IND", img:"AS"  },
  { id:24, name:"Rinku Singh",       role:"Batsman",     tier:"Domestic Star", country:"IND", img:"RSi" },
  { id:25, name:"Tilak Varma",       role:"Batsman",     tier:"Domestic Star", country:"IND", img:"TV"  },
  { id:26, name:"Deepak Hooda",      role:"All-Rounder", tier:"Domestic Star", country:"IND", img:"DH"  },
  { id:27, name:"Yashasvi Jaiswal",  role:"Batsman",     tier:"Emerging",      country:"IND", img:"YJ"  },
  { id:28, name:"Riyan Parag",       role:"All-Rounder", tier:"Emerging",      country:"IND", img:"RP"  },
  { id:29, name:"Nitish Rana",       role:"Batsman",     tier:"Emerging",      country:"IND", img:"NR"  },
  { id:30, name:"Mukesh Kumar",      role:"Bowler",      tier:"Emerging",      country:"IND", img:"MK"  },
  { id:31, name:"Abhishek Sharma",   role:"All-Rounder", tier:"Emerging",      country:"IND", img:"AbS" },
  { id:32, name:"Rajat Patidar",     role:"Batsman",     tier:"Emerging",      country:"IND", img:"RPa" },
];

const INIT_PLAYERS: Player[] = RAW_PLAYERS.map(p => ({
  ...p, basePrice: TIERS[p.tier].basePrice, soldTo: null, soldPrice: null, round: null,
}));

const INIT_TEAMS: Team[] = [
  { id:1, name:"Mumbai Indians",        short:"MI",  color:"#004BA0", captainPass:"mi123",  purse:PURSE, squad:[], marqueeCount:0 },
  { id:2, name:"Chennai Super Kings",   short:"CSK", color:"#F5A623", captainPass:"csk123", purse:PURSE, squad:[], marqueeCount:0 },
  { id:3, name:"Royal Challengers",     short:"RCB", color:"#D10000", captainPass:"rcb123", purse:PURSE, squad:[], marqueeCount:0 },
  { id:4, name:"Kolkata Knight Riders", short:"KKR", color:"#3A225D", captainPass:"kkr123", purse:PURSE, squad:[], marqueeCount:0 },
  { id:5, name:"Delhi Capitals",        short:"DC",  color:"#0078BC", captainPass:"dc123",  purse:PURSE, squad:[], marqueeCount:0 },
  { id:6, name:"Rajasthan Royals",      short:"RR",  color:"#254AA5", captainPass:"rr123",  purse:PURSE, squad:[], marqueeCount:0 },
];

const INIT_STATE: AuctionState = {
  queue: [], curIdx: 0, curBid: 0, curBidder: null,
  aRound: 0, phase: "banner", showSold: false, aDone: false,
  log: [], teams: INIT_TEAMS, players: INIT_PLAYERS,
};

// ─── UTILS ───────────────────────────────────────────────────────────────────
const fmt = (v: number): string => v >= 100 ? `₹${(v / 100).toFixed(1)}Cr` : `₹${v}L`;
const tc  = (t: string): string =>
  ({ "World Class":"#FFD700","International":"#C0C0C0","Domestic Star":"#CD7F32","Emerging":"#4fc3f7" }[t] ?? "#888");

// ─── FIREBASE HELPERS ────────────────────────────────────────────────────────
const fbRef = () => ref(db, FB_KEY);

async function readState(): Promise<AuctionState> {
  const snap = await get(fbRef());
  if (snap.exists()) return snap.val() as AuctionState;
  await set(fbRef(), INIT_STATE);
  return INIT_STATE;
}

async function writeState(s: AuctionState): Promise<void> {
  await set(fbRef(), s);
}

async function patchState(partial: Partial<AuctionState>): Promise<void> {
  await update(fbRef(), partial);
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@400;600;700&family=DM+Sans:wght@300;400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#08080f;--s1:#101018;--s2:#181825;--s3:#222232;--bd:#2e2e45;
  --gold:#FFD700;--txt:#eeeef8;--mut:#6060a0;--ok:#2ed573;--ng:#ff4757;--warn:#ffa502
}
body{background:var(--bg);color:var(--txt);font-family:'DM Sans',sans-serif;min-height:100vh;overflow-x:hidden}

/* ── LOGIN ── */
.lw{min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 30% 20%,#1a0a2e,transparent 60%),
             radial-gradient(ellipse at 70% 80%,#0a1a0e,transparent 60%),var(--bg)}
.lb{background:var(--s2);border:1px solid var(--bd);border-radius:24px;padding:44px 38px;width:100%;max-width:400px;text-align:center}
.ll{font-family:'Bebas Neue';font-size:40px;letter-spacing:4px;color:var(--gold);margin-bottom:4px}
.ls{color:var(--mut);font-size:13px;margin-bottom:32px}
.rg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px}
.rb{background:var(--s3);border:2px solid var(--bd);border-radius:12px;padding:16px 8px;
  cursor:pointer;transition:all .2s;color:var(--txt);text-align:center}
.rb:hover,.rb.sel{border-color:var(--gold);background:rgba(255,215,0,.07)}
.ri{font-size:26px;margin-bottom:5px}
.rn{font-family:'Rajdhani';font-weight:700;font-size:14px;letter-spacing:1px}
.rh{font-size:10px;color:var(--mut);margin-top:2px}
.inp{width:100%;background:var(--s1);border:1px solid var(--bd);border-radius:10px;
  padding:11px 15px;color:var(--txt);font-size:14px;outline:none;transition:border-color .2s;margin-bottom:10px}
.inp:focus{border-color:var(--gold)}
.gb{width:100%;padding:15px;background:linear-gradient(135deg,#FFD700,#FFA500);border:none;
  border-radius:12px;color:#000;font-family:'Bebas Neue';font-size:19px;letter-spacing:3px;cursor:pointer;transition:all .2s}
.gb:hover{transform:translateY(-2px);box-shadow:0 8px 28px rgba(255,215,0,.3)}
.gb:disabled{opacity:.4;cursor:not-allowed;transform:none}
.em{color:var(--ng);font-size:12px;margin-bottom:8px}
.ht{margin-top:10px;font-size:10px;color:var(--mut);line-height:1.6}

/* ── CONNECTING ── */
.conn{min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px}
.spin{width:40px;height:40px;border:3px solid var(--bd);border-top-color:var(--gold);
  border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* ── HEADER ── */
.hdr{background:linear-gradient(90deg,#08080f,#12081e,#08080f);border-bottom:1px solid var(--bd);
  padding:11px 18px;display:flex;align-items:center;justify-content:space-between;
  position:sticky;top:0;z-index:200;backdrop-filter:blur(20px)}
.hl{font-family:'Bebas Neue';font-size:21px;letter-spacing:3px;color:var(--gold)}
.hl span{color:var(--txt)}
.hr{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rp{padding:3px 11px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase}
.xb{background:var(--s3);border:1px solid var(--bd);color:var(--mut);padding:6px 12px;
  border-radius:8px;cursor:pointer;font-size:11px;transition:all .2s}
.xb:hover{border-color:var(--ng);color:var(--ng)}
.nb{background:var(--s3);border:1px solid var(--ng);color:var(--ng);padding:6px 12px;
  border-radius:8px;cursor:pointer;font-size:11px;transition:all .2s}

/* ── NAV ── */
.nav{background:var(--s1);border-bottom:1px solid var(--bd);padding:0 18px;
  display:flex;gap:2px;overflow-x:auto}
.nt{background:transparent;border:none;color:var(--mut);padding:12px 14px;cursor:pointer;
  font-family:'Rajdhani';font-weight:700;font-size:12px;letter-spacing:1px;
  border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap}
.nt:hover{color:var(--txt)}
.nt.on{color:var(--gold);border-bottom-color:var(--gold)}

/* ── ROUND BANNER ── */
.rbn{background:linear-gradient(135deg,#1a0a2e,#0a1a2e);border:1px solid var(--bd);
  border-radius:18px;padding:44px 36px;text-align:center;margin:20px auto;max-width:540px}
.rbe{font-family:'Rajdhani';font-size:12px;letter-spacing:3px;color:var(--mut);text-transform:uppercase;margin-bottom:6px}
.rbt{font-family:'Bebas Neue';font-size:50px;letter-spacing:4px;color:var(--gold);margin-bottom:8px}
.rbd{color:var(--mut);font-size:13px;margin-bottom:24px;line-height:1.6}
.rbb{padding:14px 40px;background:linear-gradient(135deg,var(--gold),#ffa500);border:none;
  border-radius:11px;color:#000;font-family:'Bebas Neue';font-size:20px;letter-spacing:3px;cursor:pointer;transition:all .2s}
.rbb:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(255,215,0,.3)}

/* ── AUCTION LAYOUT ── */
.al{display:grid;grid-template-columns:1fr 320px;min-height:calc(100vh - 108px)}
.stg{padding:20px;background:radial-gradient(ellipse at top,#1a0a2e,var(--bg) 65%);overflow-y:auto}
.st{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:8px}
.rpill{padding:5px 13px;border-radius:20px;font-family:'Rajdhani';font-weight:700;font-size:11px;
  letter-spacing:1px;background:rgba(255,215,0,.12);color:var(--gold)}
.pb{background:var(--bd);border-radius:4px;height:4px;width:160px;margin-top:4px}
.pf{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--gold),#ffa500);transition:width .5s}

/* ── SPOTLIGHT ── */
.spl{background:var(--s2);border:1px solid var(--bd);border-radius:20px;padding:26px;
  text-align:center;margin-bottom:16px;position:relative;overflow:hidden}
.spl::before{content:'';position:absolute;top:-60%;left:-30%;width:160%;height:160%;
  background:radial-gradient(ellipse,rgba(255,215,0,.04),transparent 55%);pointer-events:none}
.tt{display:inline-flex;align-items:center;gap:5px;background:var(--s1);border-radius:20px;
  padding:4px 13px;margin-bottom:14px;font-size:10px;font-weight:600;letter-spacing:1px;border:1px solid}
.pav{width:84px;height:84px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:'Bebas Neue';font-size:20px;margin:0 auto 10px;border:3px solid}
.pn{font-family:'Bebas Neue';font-size:36px;letter-spacing:3px;line-height:1;margin-bottom:8px}
.pm{display:flex;justify-content:center;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.ch{background:var(--s1);border:1px solid var(--bd);border-radius:14px;padding:3px 11px;font-size:11px}
.bb{background:var(--s1);border-radius:12px;padding:14px;margin-bottom:16px}
.bl{font-size:9px;color:var(--mut);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:2px}
.ba{font-family:'Bebas Neue';font-size:48px;letter-spacing:2px;color:var(--gold);line-height:1}
.bs{font-size:11px;color:var(--mut);margin-top:2px}
.bldr{font-family:'Rajdhani';font-size:13px;font-weight:700;margin-top:5px}

/* ── BID BUTTONS ── */
.bg{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:9px}
.tbb{padding:10px 7px;border-radius:9px;border:2px solid;cursor:pointer;
  font-family:'Rajdhani';font-weight:700;font-size:11px;transition:all .2s;text-align:left}
.tbb:disabled{opacity:.28;cursor:not-allowed}
.tbb:not(:disabled):hover{transform:translateY(-2px);filter:brightness(1.15)}
.tdg{font-family:'Bebas Neue';font-size:11px;letter-spacing:1.5px;padding:2px 5px;border-radius:3px}
.ar{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sdb{background:linear-gradient(135deg,var(--ok),#00b36b);border:none;border-radius:10px;
  color:#000;padding:13px;font-family:'Bebas Neue';font-size:19px;letter-spacing:2px;cursor:pointer;transition:all .2s}
.sdb:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 8px 20px rgba(46,213,115,.3)}
.sdb:disabled{opacity:.38;cursor:not-allowed}
.usb{background:var(--s1);border:2px solid var(--bd);border-radius:10px;
  color:var(--mut);padding:13px;font-family:'Bebas Neue';font-size:19px;letter-spacing:2px;cursor:pointer;transition:all .2s}
.usb:hover:not(:disabled){border-color:var(--ng);color:var(--ng)}
.usb:disabled{opacity:.38;cursor:not-allowed}

/* ── SOLD OVERLAY ── */
.so{position:absolute;inset:0;background:rgba(0,0,0,.88);display:flex;flex-direction:column;
  align-items:center;justify-content:center;border-radius:20px;z-index:10;animation:fi .3s ease}
.sot{font-family:'Bebas Neue';font-size:66px;letter-spacing:8px;color:var(--ok);animation:zi .4s ease}
.soto{font-size:14px;color:var(--mut);margin-top:3px}
.sop{font-family:'Bebas Neue';font-size:30px;color:var(--gold)}
@keyframes fi{from{opacity:0}to{opacity:1}}
@keyframes zi{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}

/* ── SIDEBAR ── */
.sb{background:var(--s1);border-left:1px solid var(--bd);overflow-y:auto;max-height:calc(100vh - 108px)}
.ss{padding:13px;border-bottom:1px solid var(--bd)}
.sbt{font-family:'Rajdhani';font-size:9px;font-weight:700;text-transform:uppercase;
  letter-spacing:2px;color:var(--mut);margin-bottom:11px}
.tc{background:var(--s2);border-radius:9px;padding:10px;margin-bottom:6px;
  border:1px solid var(--bd);transition:all .2s}
.tc.lead{border-color:var(--gold);box-shadow:0 0 10px rgba(255,215,0,.12)}
.tr{display:flex;justify-content:space-between;align-items:center}
.pbo{background:var(--bd);border-radius:3px;height:3px;margin-top:5px}
.pbi{height:100%;border-radius:3px;transition:width .5s}
.sc{font-size:9px;color:var(--mut);margin-top:4px}
.ls{max-height:190px;overflow-y:auto}
.lr{display:flex;gap:7px;padding:5px 0;border-bottom:1px solid var(--bd)}
.li{font-size:11px;flex-shrink:0;margin-top:1px}
.lt{font-size:10px;line-height:1.4;flex:1}
.ltime{font-size:8px;color:var(--mut)}

/* ── CAPTAIN ── */
.cw{max-width:820px;margin:0 auto;padding:16px}
.cst{background:var(--s2);border-radius:12px;padding:14px;margin-bottom:14px;
  display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.cs{background:var(--s1);border-radius:9px;padding:11px;text-align:center}
.csv{font-family:'Bebas Neue';font-size:24px;letter-spacing:1px}
.csl{font-size:9px;color:var(--mut);text-transform:uppercase;letter-spacing:1px;margin-top:2px}
.curb{background:var(--s2);border:2px solid var(--bd);border-radius:16px;padding:20px;text-align:center;transition:all .3s}
.curb.act{border-color:var(--gold);box-shadow:0 0 26px rgba(255,215,0,.1)}
.nm{color:var(--mut);font-size:13px;padding:44px 0}
.cbb{width:100%;margin-top:12px;padding:16px;border:none;border-radius:12px;color:#000;
  font-family:'Bebas Neue';font-size:21px;letter-spacing:3px;cursor:pointer;transition:all .2s}
.cbb:hover:not(:disabled){transform:translateY(-3px)}
.cbb:disabled{opacity:.35;cursor:not-allowed}

/* ── PLAYERS ── */
.pgw{padding:16px;max-width:1100px;margin:0 auto}
.fr{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:14px}
.fb{background:var(--s2);border:1px solid var(--bd);color:var(--mut);padding:4px 11px;
  border-radius:14px;cursor:pointer;font-size:11px;transition:all .2s}
.fb.on,.fb:hover{border-color:var(--gold);color:var(--gold)}
.pgg{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:9px}
.pc{background:var(--s2);border:1px solid var(--bd);border-radius:11px;padding:12px;transition:all .2s}
.pc:hover{border-color:#444}
.pc.sp{opacity:.5}
.pcav{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:'Bebas Neue';font-size:10px;border:2px solid;margin-bottom:7px}
.pcn{font-family:'Rajdhani';font-weight:700;font-size:13px;margin-bottom:2px}
.pcr{font-size:10px;color:var(--mut);margin-bottom:5px}
.pctb{font-size:8px;padding:2px 6px;border-radius:7px;background:var(--s1);display:inline-block}
.pcs{font-size:9px;color:var(--ok);font-weight:600;margin-top:4px}
.pcb{font-size:9px;color:var(--mut);margin-top:3px}

/* ── TEAMS GRID ── */
.tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;
  padding:16px;max-width:1100px;margin:0 auto}
.tfc{background:var(--s2);border:1px solid var(--bd);border-radius:13px;overflow:hidden}
.tfh{padding:14px;display:flex;justify-content:space-between;align-items:center}
.tfn{font-family:'Bebas Neue';font-size:17px;letter-spacing:2px}
.tfs{display:flex;gap:7px;padding:0 14px 10px}
.tv{background:var(--s1);border-radius:7px;padding:7px 9px;flex:1;text-align:center}
.tvv{font-family:'Rajdhani';font-weight:700;font-size:15px}
.tvl{font-size:8px;color:var(--mut);text-transform:uppercase;letter-spacing:1px}
.tfl{padding:0 14px 14px}
.tpr{display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:1px solid var(--bd)}
.tpr:last-child{border-bottom:none}
.tpa{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:7px;font-weight:700;border:1.5px solid;flex-shrink:0}
.tpi{flex:1}
.tpn{font-size:11px;font-weight:600}
.tps{font-size:9px;color:var(--mut)}
.tpp{font-family:'Rajdhani';font-weight:700;font-size:10px;color:var(--gold)}
.mq{font-size:7px;background:var(--gold);color:#000;padding:1px 3px;border-radius:2px;
  font-weight:700;letter-spacing:.5px;margin-left:3px}

/* ── VIEWER TICKER ── */
.vtk{background:var(--s1);border-bottom:1px solid var(--bd);padding:8px 16px;
  display:flex;align-items:center;gap:9px}
.vld{background:var(--ng);color:#fff;font-size:8px;font-weight:700;padding:2px 5px;
  border-radius:3px;letter-spacing:1px;animation:pulse 1.5s infinite;flex-shrink:0}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.vtxt{font-size:11px;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── SQUAD GRID ── */
.sqg{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:9px}
.sqc{background:var(--s2);border:1px solid var(--bd);border-radius:11px;padding:12px}

/* ── DONE ── */
.done{text-align:center;padding:44px 20px}
.dtr{font-size:68px;animation:bou 1s infinite alternate}
@keyframes bou{from{transform:translateY(0)}to{transform:translateY(-9px)}}
.dtl{font-family:'Bebas Neue';font-size:50px;letter-spacing:5px;color:var(--gold);margin:12px 0 6px}

::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-track{background:var(--s1)}
::-webkit-scrollbar-thumb{background:var(--bd);border-radius:3px}

@media(max-width:680px){
  .al{grid-template-columns:1fr}
  .sb{max-height:240px;border-left:none;border-top:1px solid var(--bd)}
  .pn{font-size:24px}.ba{font-size:34px}.bg{grid-template-columns:repeat(2,1fr)}
  .cst{grid-template-columns:repeat(2,1fr)}
  .nt{padding:10px 9px;font-size:11px}
  .lb{padding:32px 20px}
}
`;

// ─── ROOT COMPONENT ───────────────────────────────────────────────────────────
export default function App() {
  const [role,     setRole]     = useState<Role>("login");
  const [myTeamId, setMyTeamId] = useState<number | null>(null);
  const [st,       setSt]       = useState<AuctionState>(INIT_STATE);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);

  // ── Subscribe to Firebase ──
  useEffect(() => {
    const unsub = onValue(fbRef(), snap => {
      if (snap.exists()) setSt(snap.val() as AuctionState);
      else writeState(INIT_STATE);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Write helper ──
  const write = useCallback(async (next: AuctionState) => {
    setSaving(true);
    await writeState(next);
    setSaving(false);
  }, []);

  const patch = useCallback(async (partial: Partial<AuctionState>) => {
    setSaving(true);
    await patchState(partial);
    setSaving(false);
  }, []);

  // ── Derived ──
  const curPlayer: Player | undefined =
    st.queue.length > 0 ? st.players.find(p => p.id === st.queue[st.curIdx]) : undefined;

  const canBid = useCallback((team: Team): boolean => {
    if (st.showSold || !curPlayer || st.phase !== "running") return false;
    if (team.squad.length >= MAX_SQUAD) return false;
    if (curPlayer.tier === "World Class" && team.marqueeCount >= MAX_MARQUEE) return false;
    const nb = st.curBidder !== null ? st.curBid + MIN_BID : curPlayer.basePrice;
    if (team.purse < nb) return false;
    if (team.id === st.curBidder) return false;
    return true;
  }, [st, curPlayer]);

  const addLogEntry = (prev: AuctionState, icon: string, text: string): LogItem[] => {
    const time = new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
    return [{ icon, text, time }, ...(prev.log ?? []).slice(0, 59)];
  };

  // ── Actions ──
  const startRound = async (round: number) => {
    const snap = await readState();
    const sorted = [...snap.players].sort((a,b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
    const queue = round === 1
      ? sorted.map(p => p.id)
      : sorted.filter(p => p.soldTo === null).map(p => p.id);
    if (queue.length === 0) {
      alert("No unsold players left!"); return;
    }
    const first = snap.players.find(p => p.id === queue[0]);
    const log = addLogEntry(snap, "🎙️", `Round ${round} started! ${queue.length} players.`);
    await write({ ...snap, queue, curIdx: 0, curBid: first?.basePrice ?? 0,
                  curBidder: null, aRound: round, phase: "running", showSold: false, log });
  };

  const placeBid = async (teamId: number) => {
    const snap = await readState();
    const cp = snap.players.find(p => p.id === snap.queue[snap.curIdx]);
    if (!cp || snap.phase !== "running") return;
    const team = snap.teams.find(t => t.id === teamId);
    if (!team) return;
    const nb = snap.curBidder !== null ? snap.curBid + MIN_BID : cp.basePrice;
    if (team.purse < nb) return;
    const log = addLogEntry(snap, "💰", `${team.short} bid ${fmt(nb)} for ${cp.name}`);
    await patch({ curBid: nb, curBidder: teamId, log });
  };

  const doSold = async () => {
    const snap = await readState();
    if (snap.curBidder === null) return;
    const cp = snap.players.find(p => p.id === snap.queue[snap.curIdx]);
    if (!cp) return;
    const team = snap.teams.find(t => t.id === snap.curBidder);
    if (!team) return;
    const isMarquee = cp.tier === "World Class";
    const sp: SquadPlayer = { ...cp, soldPrice: snap.curBid, isMarquee, round: snap.aRound };
    const newTeams = snap.teams.map(t => t.id === snap.curBidder
      ? { ...t, purse: t.purse - snap.curBid, squad: [...t.squad, sp],
               marqueeCount: isMarquee ? t.marqueeCount + 1 : t.marqueeCount }
      : t
    );
    const newPlayers = snap.players.map(p =>
      p.id === cp.id ? { ...p, soldTo: snap.curBidder, soldPrice: snap.curBid, round: snap.aRound } : p
    );
    const log = addLogEntry(snap, "🔨", `SOLD! ${cp.name} → ${team.short} for ${fmt(snap.curBid)}`);
    await write({ ...snap, teams: newTeams, players: newPlayers, showSold: true, log });
    setTimeout(() => advancePlayer(), 2100);
  };

  const doUnsold = async () => {
    const snap = await readState();
    const cp = snap.players.find(p => p.id === snap.queue[snap.curIdx]);
    if (!cp) return;
    const log = addLogEntry(snap, "❌", `${cp.name} UNSOLD (Round ${snap.aRound})`);
    await patch({ log });
    advancePlayer();
  };

  const advancePlayer = async () => {
    const snap = await readState();
    const next = snap.curIdx + 1;
    if (next >= snap.queue.length) {
      if (snap.aRound >= TOTAL_ROUNDS) {
        const log = addLogEntry(snap, "🏆", "All 3 rounds done! Parstriker Auction complete!");
        await write({ ...snap, showSold: false, aDone: true, phase: "done", log });
      } else {
        const log = addLogEntry(snap, "🔔", `Round ${snap.aRound} complete! Unsold players re-enter next round.`);
        await write({ ...snap, showSold: false, phase: "banner", log });
      }
    } else {
      const np = snap.players.find(p => p.id === snap.queue[next]);
      await patch({ curIdx: next, curBid: np?.basePrice ?? 0, curBidder: null, showSold: false });
    }
  };

  const resetAll = async () => {
    if (!window.confirm("Reset ALL Parstriker auction data? Cannot be undone.")) return;
    await writeState(INIT_STATE);
  };

  const logout = () => { setRole("login"); setMyTeamId(null); };

  const myTeam   = myTeamId !== null ? st.teams.find(t => t.id === myTeamId) : undefined;
  const leadTeam = st.curBidder !== null ? st.teams.find(t => t.id === st.curBidder) : undefined;
  const soldCount = st.players.filter(p => p.soldTo !== null).length;
  const progPct   = st.queue.length > 0 ? Math.round((st.curIdx / st.queue.length) * 100) : 0;

  if (loading) return (
    <>
      <style>{CSS}</style>
      <div className="conn">
        <div className="spin" />
        <div style={{color:"var(--mut)",fontSize:13}}>Connecting to Parstriker server...</div>
      </div>
    </>
  );

  return (
    <>
      <style>{CSS}</style>
      {saving && (
        <div style={{position:"fixed",bottom:12,right:12,background:"var(--s3)",border:"1px solid var(--bd)",
          borderRadius:8,padding:"6px 12px",fontSize:11,color:"var(--mut)",zIndex:999}}>
          ⏳ Syncing...
        </div>
      )}

      {role === "login" && (
        <LoginScreen
          teams={st.teams}
          onLogin={(r, tid) => { setRole(r); if (tid !== undefined) setMyTeamId(tid); }}
        />
      )}

      {role === "admin" && (
        <AdminView
          st={st} curPlayer={curPlayer} leadTeam={leadTeam}
          soldCount={soldCount} progPct={progPct}
          onBid={placeBid} onSold={doSold} onUnsold={doUnsold}
          onStartRound={startRound} onLogout={logout} onReset={resetAll}
          canBid={canBid}
        />
      )}

      {role === "captain" && myTeam !== undefined && (
        <CaptainView
          myTeam={myTeam} st={st} curPlayer={curPlayer}
          onBid={placeBid} onLogout={logout} canBid={canBid(myTeam)}
        />
      )}

      {role === "viewer" && (
        <ViewerView
          st={st} curPlayer={curPlayer} leadTeam={leadTeam}
          soldCount={soldCount} onLogout={logout}
        />
      )}
    </>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({ teams, onLogin }: {
  teams: Team[];
  onLogin: (r: Role, tid?: number) => void;
}) {
  const [sel,  setSel]  = useState<Role | null>(null);
  const [pass, setPass] = useState("");
  const [err,  setErr]  = useState("");

  const tryLogin = () => {
    setErr("");
    if (!sel) return;
    if (sel === "viewer") { onLogin("viewer"); return; }
    if (sel === "admin") {
      if (pass === ADMIN_PASS) onLogin("admin");
      else setErr("Wrong admin password");
      return;
    }
    const team = teams.find(t => t.captainPass === pass);
    if (team) onLogin("captain", team.id);
    else setErr("Wrong captain password");
  };

  const roles = [
    { r:"admin"   as Role, ic:"🎙️", nm:"Admin",   hn:"Parstriker control" },
    { r:"captain" as Role, ic:"👑", nm:"Captain", hn:"Bid for players"    },
    { r:"viewer"  as Role, ic:"👁️", nm:"Viewer",  hn:"Watch live"         },
  ];

  return (
    <div className="lw">
      <div className="lb">
        <div className="ll">🏏 PARSTRIKER AUCTION</div>
        <div className="ls">Select your role to enter the Parstriker auction room</div>
        <div className="rg">
          {roles.map(({ r, ic, nm, hn }) => (
            <div key={r} className={`rb ${sel===r?"sel":""}`}
              onClick={() => { setSel(r); setPass(""); setErr(""); }}>
              <div className="ri">{ic}</div>
              <div className="rn">{nm}</div>
              <div className="rh">{hn}</div>
            </div>
          ))}
        </div>
        {err && <div className="em">{err}</div>}
        {sel && sel !== "viewer" && (
          <input className="inp" type="password"
            placeholder={sel === "admin" ? "Admin password" : "Captain password e.g. mi123"}
            value={pass} onChange={e => setPass(e.target.value)}
            onKeyDown={e => e.key === "Enter" && tryLogin()} />
        )}
        {sel === "viewer" && <div style={{fontSize:12,color:"var(--mut)",marginBottom:10}}>No password needed</div>}
        <button className="gb" disabled={!sel} onClick={tryLogin}>ENTER</button>
        <div className="ht">
          Admin: <b>admin123</b><br/>
          Captains: mi123 · csk123 · rcb123 · kkr123 · dc123 · rr123
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
function AdminView({ st, curPlayer, leadTeam, soldCount, progPct,
  onBid, onSold, onUnsold, onStartRound, onLogout, onReset, canBid }: {
  st: AuctionState; curPlayer: Player | undefined; leadTeam: Team | undefined;
  soldCount: number; progPct: number;
  onBid: (id: number) => void; onSold: () => void; onUnsold: () => void;
  onStartRound: (r: number) => void; onLogout: () => void; onReset: () => void;
  canBid: (t: Team) => boolean;
}) {
  const [tab,    setTab]    = useState<"auction"|"players"|"teams">("auction");
  const [filter, setFilter] = useState("All");

  return (
    <div>
      <div className="hdr">
        <div className="hl">🏏 <span>PARSTRIKER</span> ADMIN</div>
        <div className="hr">
          <span className="rp" style={{background:"rgba(255,215,0,.15)",color:"var(--gold)"}}>🎙️ ADMIN</span>
          <button className="xb" onClick={onLogout}>Logout</button>
          <button className="nb" onClick={onReset}>Reset All</button>
        </div>
      </div>
      <div className="nav">
        {(["auction","players","teams"] as const).map(t => (
          <button key={t} className={`nt ${tab===t?"on":""}`} onClick={() => setTab(t)}>
            {t==="auction"?"🔨 AUCTION":t==="players"?"🏏 PLAYERS":"🏆 TEAMS"}
          </button>
        ))}
      </div>

      {tab === "auction" && (
        st.aDone ? <DoneScreen teams={st.teams} /> :
        st.phase === "banner" ? (
          <div style={{padding:"16px"}}>
            <div className="rbn">
              <div className="rbe">{st.aRound === 0 ? "WELCOME TO THE" : `ROUND ${st.aRound} COMPLETE`}</div>
              <div className="rbt">{st.aRound === 0 ? "PARSTRIKER AUCTION" : `ROUND ${st.aRound+1}`}</div>
              <div className="rbd">
                {st.aRound === 0
                  ? `${st.players.length} players · ${TOTAL_ROUNDS} rounds · ${st.teams.length} teams · Purse ${fmt(PURSE)}`
                  : `${st.players.filter(p=>p.soldTo===null).length} unsold players re-enter · Round ${st.aRound+1} of ${TOTAL_ROUNDS}`}
              </div>
              <button className="rbb" onClick={() => onStartRound(st.aRound+1)}>
                {st.aRound === 0 ? "⚡ START AUCTION" : `▶ BEGIN ROUND ${st.aRound+1}`}
              </button>
            </div>
            <div className="tgrid"><TeamCards teams={st.teams} /></div>
          </div>
        ) : (
          <div className="al">
            <div className="stg">
              <div className="st">
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <div className="rpill">ROUND {st.aRound}/{TOTAL_ROUNDS}</div>
                  <div style={{fontSize:10,color:"var(--mut)"}}>Sold: {soldCount}/{st.players.length}</div>
                </div>
                <div>
                  <div style={{fontSize:9,color:"var(--mut)",marginBottom:3}}>Player {st.curIdx+1}/{st.queue.length}</div>
                  <div className="pb"><div className="pf" style={{width:`${progPct}%`}} /></div>
                </div>
              </div>

              {curPlayer && (
                <>
                  <div className="spl">
                    {st.showSold && (
                      <div className="so">
                        <div className="sot">SOLD!</div>
                        <div className="soto">to {leadTeam?.name ?? ""}</div>
                        <div className="sop">{fmt(st.curBid)}</div>
                      </div>
                    )}
                    <div className="tt" style={{color:tc(curPlayer.tier),borderColor:`${tc(curPlayer.tier)}44`}}>
                      {TIERS[curPlayer.tier]?.badge} {curPlayer.tier}
                    </div>
                    <div className="pav" style={{borderColor:tc(curPlayer.tier),background:`${tc(curPlayer.tier)}18`,color:tc(curPlayer.tier)}}>
                      {curPlayer.img}
                    </div>
                    <div className="pn">{curPlayer.name}</div>
                    <div className="pm">
                      <span className="ch">🏏 {curPlayer.role}</span>
                      <span className="ch">🌍 {curPlayer.country}</span>
                      <span className="ch">Base {fmt(curPlayer.basePrice)}</span>
                    </div>
                    <div className="bb">
                      <div className="bl">{st.curBidder !== null ? "Current Bid" : "Opening Price"}</div>
                      <div className="ba">{fmt(st.curBid)}</div>
                      <div className="bs">+{fmt(MIN_BID)} per raise</div>
                      {leadTeam && <div className="bldr" style={{color:leadTeam.color}}>🔥 {leadTeam.name} leading</div>}
                    </div>
                  </div>

                  <div className="bg">
                    {st.teams.map(team => {
                      const able = canBid(team);
                      const isLead = team.id === st.curBidder;
                      const nb = st.curBidder !== null ? st.curBid + MIN_BID : curPlayer.basePrice;
                      return (
                        <button key={team.id} className="tbb" disabled={!able}
                          style={{borderColor:isLead?team.color:"var(--bd)",background:isLead?`${team.color}20`:"var(--s2)",color:isLead?team.color:"var(--txt)"}}
                          onClick={() => onBid(team.id)}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <span className="tdg" style={{background:`${team.color}22`,color:team.color}}>{team.short}</span>
                            {able && <span style={{fontSize:9,color:"var(--gold)",fontFamily:"'Bebas Neue'"}}>{fmt(nb)}</span>}
                          </div>
                          <div style={{fontSize:8,opacity:.55,marginTop:2}}>{fmt(team.purse)}</div>
                          {isLead && <div style={{fontSize:8,color:"var(--ok)",marginTop:1}}>● LEADING</div>}
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
                {st.teams.map(team => {
                  const pct = (team.purse / PURSE) * 100;
                  return (
                    <div key={team.id} className={`tc ${team.id===st.curBidder?"lead":""}`}>
                      <div className="tr">
                        <span className="tdg" style={{background:team.color,color:"#fff"}}>{team.short}</span>
                        <span style={{fontSize:10,fontWeight:600,color:pct<20?"var(--ng)":"var(--gold)"}}>{fmt(team.purse)}</span>
                      </div>
                      <div className="pbo"><div className="pbi" style={{width:`${pct}%`,background:pct<20?"var(--ng)":team.color}} /></div>
                      <div className="sc">Squad {team.squad.length}/{MAX_SQUAD} · Marquee {team.marqueeCount}/{MAX_MARQUEE}</div>
                    </div>
                  );
                })}
              </div>
              <div className="ss">
                <div className="sbt">Bid Log</div>
                <div className="ls">
                  {(st.log ?? []).length === 0 && <div style={{color:"var(--mut)",fontSize:10,padding:"3px 0"}}>No activity yet</div>}
                  {(st.log ?? []).map((l, i) => (
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

      {tab === "players" && (
        <div className="pgw">
          <div style={{marginBottom:12}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:26,letterSpacing:2}}>Player Pool</div>
            <div style={{fontSize:11,color:"var(--mut)"}}>{soldCount} sold · {st.players.length-soldCount} available</div>
          </div>
          <div className="fr">
            {["All","Available","Sold",...Object.keys(TIERS)].map(f => (
              <button key={f} className={`fb ${filter===f?"on":""}`} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
          <div className="pgg">
            {st.players.filter(p => {
              if (filter === "Available") return p.soldTo === null;
              if (filter === "Sold")      return p.soldTo !== null;
              if (filter === "All")       return true;
              return p.tier === filter;
            }).map(p => {
              const sold = p.soldTo !== null ? st.teams.find(t => t.id === p.soldTo) : undefined;
              return (
                <div key={p.id} className={`pc ${p.soldTo!==null?"sp":""}`}>
                  <div className="pcav" style={{borderColor:tc(p.tier),background:`${tc(p.tier)}18`,color:tc(p.tier)}}>{p.img.slice(0,2)}</div>
                  <div className="pcn">{p.name}</div>
                  <div className="pcr">{p.role} · {p.country}</div>
                  <div className="pctb" style={{color:tc(p.tier)}}>{TIERS[p.tier]?.badge} {p.tier}</div>
                  {sold ? <div className="pcs">✓ {sold.short} · {fmt(p.soldPrice??0)} · R{p.round}</div>
                        : <div className="pcb">Base: {fmt(p.basePrice)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "teams" && <div className="tgrid"><TeamCards teams={st.teams} /></div>}
    </div>
  );
}

// ─── CAPTAIN ──────────────────────────────────────────────────────────────────
function CaptainView({ myTeam, st, curPlayer, onBid, onLogout, canBid }: {
  myTeam: Team; st: AuctionState; curPlayer: Player | undefined;
  onBid: (id: number) => void; onLogout: () => void; canBid: boolean;
}) {
  const [tab, setTab] = useState<"bid"|"squad"|"log">("bid");
  const isLeading = st.curBidder === myTeam.id;
  const pctLeft   = (myTeam.purse / PURSE) * 100;
  const nextBid   = st.curBidder !== null ? st.curBid + MIN_BID : curPlayer?.basePrice ?? 0;
  const myLogs    = (st.log ?? []).filter(l => l.text.includes(myTeam.short));

  return (
    <div>
      <div className="hdr">
        <div className="hl">🏏 <span style={{color:myTeam.color}}>{myTeam.short}</span> · {myTeam.name}</div>
        <div className="hr">
          <span className="rp" style={{background:`${myTeam.color}22`,color:myTeam.color}}>👑 CAPTAIN</span>
          <button className="xb" onClick={onLogout}>Logout</button>
        </div>
      </div>
      <div className="nav">
        <button className={`nt ${tab==="bid"?"on":""}`}   onClick={() => setTab("bid")}>🔨 LIVE BID</button>
        <button className={`nt ${tab==="squad"?"on":""}`} onClick={() => setTab("squad")}>🏏 MY SQUAD ({myTeam.squad.length})</button>
        <button className={`nt ${tab==="log"?"on":""}`}   onClick={() => setTab("log")}>📋 ACTIVITY ({myLogs.length})</button>
      </div>

      {tab === "bid" && (
        <div className="cw">
          <div className="cst">
            <div className="cs">
              <div className="csv" style={{color:"var(--gold)"}}>{fmt(myTeam.purse)}</div>
              <div className="csl">Purse Left</div>
              <div style={{background:"var(--bd)",borderRadius:3,height:3,marginTop:5}}>
                <div style={{height:"100%",borderRadius:3,background:pctLeft<20?"var(--ng)":myTeam.color,width:`${pctLeft}%`,transition:"width .5s"}} />
              </div>
            </div>
            <div className="cs">
              <div className="csv">{myTeam.squad.length}/{MAX_SQUAD}</div>
              <div className="csl">Squad</div>
            </div>
            <div className="cs">
              <div className="csv">{myTeam.marqueeCount}/{MAX_MARQUEE}</div>
              <div className="csl">Marquee</div>
            </div>
            <div className="cs">
              <div className="csv" style={{color:"var(--warn)"}}>{st.aRound > 0 ? `R${st.aRound}` : "—"}</div>
              <div className="csl">Round</div>
            </div>
          </div>

          <div className={`curb ${st.phase==="running"&&curPlayer?"act":""}`}>
            {st.phase === "banner"  && <div className="nm">⏳ Waiting for admin to start the auction…</div>}
            {st.phase === "done"    && <div className="nm">🏆 Auction complete! Check your Squad tab.</div>}
            {st.phase === "running" && !curPlayer && <div className="nm">Loading next player…</div>}
            {st.phase === "running" && curPlayer && (
              <>
                <div className="tt" style={{color:tc(curPlayer.tier),borderColor:`${tc(curPlayer.tier)}44`,border:"1px solid",
                  display:"inline-flex",alignItems:"center",gap:5,padding:"4px 12px",borderRadius:20,marginBottom:12,fontSize:10,fontWeight:600,letterSpacing:1}}>
                  {TIERS[curPlayer.tier]?.badge} {curPlayer.tier}
                </div>
                <div style={{width:76,height:76,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                  fontFamily:"'Bebas Neue'",fontSize:18,margin:"0 auto 9px",border:`3px solid ${tc(curPlayer.tier)}`,
                  background:`${tc(curPlayer.tier)}18`,color:tc(curPlayer.tier)}}>
                  {curPlayer.img}
                </div>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:32,letterSpacing:2,marginBottom:7}}>{curPlayer.name}</div>
                <div style={{display:"flex",justifyContent:"center",gap:7,marginBottom:12,flexWrap:"wrap"}}>
                  <span className="ch">{curPlayer.role}</span>
                  <span className="ch">{curPlayer.country}</span>
                  <span className="ch">Base {fmt(curPlayer.basePrice)}</span>
                </div>
                <div style={{background:"var(--s1)",borderRadius:11,padding:13,marginBottom:4}}>
                  <div style={{fontSize:9,color:"var(--mut)",textTransform:"uppercase",letterSpacing:1.5,marginBottom:2}}>
                    {isLeading ? "🔥 YOU ARE LEADING" : st.curBidder !== null ? "Bid in Progress" : "Opening Price"}
                  </div>
                  <div style={{fontFamily:"'Bebas Neue'",fontSize:44,color:isLeading?"var(--ok)":"var(--gold)",lineHeight:1}}>{fmt(st.curBid)}</div>
                  {!isLeading && st.curBidder !== null && (
                    <div style={{fontSize:11,color:"var(--ng)",marginTop:3}}>⚠ Another team is leading!</div>
                  )}
                </div>
                <button className="cbb"
                  style={{background:isLeading?"linear-gradient(135deg,var(--ok),#00b36b)":"linear-gradient(135deg,var(--gold),#ffa500)"}}
                  disabled={!canBid} onClick={() => onBid(myTeam.id)}>
                  {isLeading ? `✓ LEADING ${fmt(st.curBid)}` : canBid ? `BID ${fmt(nextBid)}` : "CANNOT BID"}
                </button>
                {!canBid && !isLeading && (
                  <div style={{fontSize:10,color:"var(--mut)",marginTop:6}}>
                    {myTeam.purse < nextBid ? "⚠ Insufficient purse" :
                     myTeam.squad.length >= MAX_SQUAD ? "⚠ Squad full" :
                     curPlayer.tier === "World Class" && myTeam.marqueeCount >= MAX_MARQUEE ? "⚠ Marquee slots full" :
                     "Bidding paused"}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "squad" && (
        <div className="cw">
          <div style={{marginBottom:12}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:26,letterSpacing:2}}>{myTeam.name} Squad</div>
            <div style={{fontSize:11,color:"var(--mut)"}}>
              {myTeam.squad.length} players · Spent: {fmt(PURSE - myTeam.purse)} · Remaining: {fmt(myTeam.purse)}
            </div>
          </div>
          {myTeam.squad.length === 0 ? (
            <div style={{color:"var(--mut)",textAlign:"center",padding:"50px 0"}}>No players acquired yet</div>
          ) : (
            <div className="sqg">
              {myTeam.squad.map(p => (
                <div key={p.id} className="sqc">
                  <div style={{width:40,height:40,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                    fontFamily:"'Bebas Neue'",fontSize:10,border:`2px solid ${tc(p.tier)}`,background:`${tc(p.tier)}18`,
                    color:tc(p.tier),marginBottom:8}}>
                    {p.img.slice(0,2)}
                  </div>
                  <div style={{fontFamily:"'Rajdhani'",fontWeight:700,fontSize:12,marginBottom:2}}>
                    {p.name}{p.isMarquee&&<span className="mq">M</span>}
                  </div>
                  <div style={{fontSize:9,color:"var(--mut)",marginBottom:4}}>{p.role} · {p.country}</div>
                  <div style={{fontFamily:"'Rajdhani'",fontWeight:700,fontSize:12,color:"var(--gold)"}}>{fmt(p.soldPrice)} · R{p.round}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "log" && (
        <div className="cw">
          <div style={{fontFamily:"'Bebas Neue'",fontSize:26,letterSpacing:2,marginBottom:12}}>My Activity</div>
          {myLogs.length === 0 ? (
            <div style={{color:"var(--mut)",textAlign:"center",padding:"50px 0"}}>No activity for {myTeam.short} yet</div>
          ) : (
            myLogs.map((l, i) => (
              <div key={i} style={{display:"flex",gap:9,padding:"9px 0",borderBottom:"1px solid var(--bd)"}}>
                <span style={{fontSize:16}}>{l.icon}</span>
                <div>
                  <div style={{fontSize:12}}>{l.text}</div>
                  <div style={{fontSize:9,color:"var(--mut)"}}>{l.time}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── VIEWER ───────────────────────────────────────────────────────────────────
function ViewerView({ st, curPlayer, leadTeam, soldCount, onLogout }: {
  st: AuctionState; curPlayer: Player | undefined; leadTeam: Team | undefined;
  soldCount: number; onLogout: () => void;
}) {
  const [tab, setTab] = useState<"live"|"teams"|"players">("live");

  return (
    <div>
      <div className="hdr">
        <div className="hl">🏏 <span>PARSTRIKER AUCTION</span></div>
        <div className="hr">
          <span className="rp" style={{background:"rgba(79,195,247,.12)",color:"#4fc3f7"}}>👁️ VIEWER</span>
          <button className="xb" onClick={onLogout}>Exit</button>
        </div>
      </div>

      {st.phase === "running" && curPlayer && (
        <div className="vtk">
          <span className="vld">LIVE</span>
          <span className="vtxt">
            On stage: <b style={{color:"var(--txt)"}}>{curPlayer.name}</b>
            {" · "}Bid: <b style={{color:"var(--gold)"}}>{fmt(st.curBid)}</b>
            {leadTeam && <span> · <b style={{color:leadTeam.color}}>{leadTeam.name}</b> leading</span>}
            {" · "}Round {st.aRound}/{TOTAL_ROUNDS} · Sold: {soldCount}/{st.players.length}
          </span>
        </div>
      )}

      <div className="nav">
        <button className={`nt ${tab==="live"?"on":""}`}    onClick={() => setTab("live")}>📡 LIVE STAGE</button>
        <button className={`nt ${tab==="teams"?"on":""}`}   onClick={() => setTab("teams")}>🏆 TEAM SQUADS</button>
        <button className={`nt ${tab==="players"?"on":""}`} onClick={() => setTab("players")}>🏏 ALL PLAYERS</button>
      </div>

      {tab === "live" && (
        <div style={{padding:"16px",maxWidth:500,margin:"0 auto"}}>
          {st.phase !== "running" ? (
            <div style={{textAlign:"center",padding:"70px 20px",color:"var(--mut)"}}>
              <div style={{fontSize:44,marginBottom:14}}>{st.phase==="done"?"🏆":"⏳"}</div>
              <div style={{fontSize:14}}>{st.phase==="done"?"Auction complete!":"Auction hasn't started yet."}</div>
            </div>
          ) : curPlayer ? (
            <>
              <div className="spl" style={{marginBottom:14}}>
                <div className="tt" style={{color:tc(curPlayer.tier),borderColor:`${tc(curPlayer.tier)}44`,border:"1px solid",
                  display:"inline-flex",gap:5,padding:"4px 12px",borderRadius:20,marginBottom:12,fontSize:10,fontWeight:600,letterSpacing:1}}>
                  {TIERS[curPlayer.tier]?.badge} {curPlayer.tier}
                </div>
                <div style={{width:76,height:76,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                  fontFamily:"'Bebas Neue'",fontSize:18,margin:"0 auto 9px",border:`3px solid ${tc(curPlayer.tier)}`,
                  background:`${tc(curPlayer.tier)}18`,color:tc(curPlayer.tier)}}>
                  {curPlayer.img}
                </div>
                <div style={{fontFamily:"'Bebas Neue'",fontSize:34,letterSpacing:3,marginBottom:7}}>{curPlayer.name}</div>
                <div style={{display:"flex",justifyContent:"center",gap:7,marginBottom:14,flexWrap:"wrap"}}>
                  <span className="ch">{curPlayer.role}</span>
                  <span className="ch">{curPlayer.country}</span>
                  <span className="ch">Base {fmt(curPlayer.basePrice)}</span>
                </div>
                <div style={{background:"var(--s1)",borderRadius:11,padding:14}}>
                  <div style={{fontSize:9,color:"var(--mut)",textTransform:"uppercase",letterSpacing:1.5,marginBottom:2}}>Current Bid</div>
                  <div style={{fontFamily:"'Bebas Neue'",fontSize:48,color:"var(--gold)",lineHeight:1}}>{fmt(st.curBid)}</div>
                  {leadTeam && <div style={{fontFamily:"'Rajdhani'",fontWeight:700,fontSize:14,marginTop:5,color:leadTeam.color}}>🔥 {leadTeam.name}</div>}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}>
                {st.teams.map(t => (
                  <div key={t.id} style={{background:"var(--s2)",borderRadius:9,padding:"8px 7px",textAlign:"center",
                    border:`1px solid ${t.id===leadTeam?.id?t.color:"var(--bd)"}`,transition:"all .3s"}}>
                    <div style={{fontFamily:"'Bebas Neue'",fontSize:12,color:t.color,letterSpacing:1}}>{t.short}</div>
                    <div style={{fontSize:10,color:"var(--gold)",fontWeight:600}}>{fmt(t.purse)}</div>
                    <div style={{fontSize:8,color:"var(--mut)"}}>{t.squad.length}pl</div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      )}

      {tab === "teams"   && <div className="tgrid"><TeamCards teams={st.teams} /></div>}

      {tab === "players" && (
        <div className="pgw">
          <div style={{marginBottom:12}}>
            <div style={{fontFamily:"'Bebas Neue'",fontSize:26,letterSpacing:2}}>All Players</div>
            <div style={{fontSize:11,color:"var(--mut)"}}>{soldCount} sold · {st.players.length-soldCount} available</div>
          </div>
          <div className="pgg">
            {st.players.map(p => {
              const sold = p.soldTo !== null ? st.teams.find(t => t.id === p.soldTo) : undefined;
              return (
                <div key={p.id} className={`pc ${p.soldTo!==null?"sp":""}`}>
                  <div className="pcav" style={{borderColor:tc(p.tier),background:`${tc(p.tier)}18`,color:tc(p.tier)}}>{p.img.slice(0,2)}</div>
                  <div className="pcn">{p.name}</div>
                  <div className="pcr">{p.role} · {p.country}</div>
                  <div className="pctb" style={{color:tc(p.tier)}}>{TIERS[p.tier]?.badge} {p.tier}</div>
                  {sold ? <div className="pcs">✓ {sold.short} · {fmt(p.soldPrice??0)}</div>
                        : <div className="pcb">Base: {fmt(p.basePrice)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── REUSABLE COMPONENTS ──────────────────────────────────────────────────────
function TeamCards({ teams }: { teams: Team[] }) {
  return (
    <>
      {teams.map(team => (
        <div key={team.id} className="tfc">
          <div className="tfh" style={{background:`linear-gradient(135deg,${team.color}18,transparent)`,borderBottom:`3px solid ${team.color}`}}>
            <div>
              <div className="tfn">{team.name}</div>
              <div style={{fontSize:9,color:"var(--mut)"}}>Purse: {fmt(team.purse)}</div>
            </div>
            <div className="tdg" style={{background:team.color,color:"#fff"}}>{team.short}</div>
          </div>
          <div className="tfs">
            <div className="tv"><div className="tvv" style={{color:"var(--gold)"}}>{fmt(team.purse)}</div><div className="tvl">Left</div></div>
            <div className="tv"><div className="tvv">{team.squad.length}/{MAX_SQUAD}</div><div className="tvl">Players</div></div>
            <div className="tv"><div className="tvv">{team.marqueeCount}/{MAX_MARQUEE}</div><div className="tvl">Marquee</div></div>
          </div>
          <div className="tfl">
            {team.squad.length === 0 && <div style={{color:"var(--mut)",fontSize:10,padding:"5px 0"}}>No players yet</div>}
            {team.squad.map(p => (
              <div key={p.id} className="tpr">
                <div className="tpa" style={{borderColor:tc(p.tier),background:`${tc(p.tier)}18`,color:tc(p.tier)}}>{p.img.slice(0,2)}</div>
                <div className="tpi">
                  <div className="tpn">{p.name}{p.isMarquee&&<span className="mq">M</span>}</div>
                  <div className="tps">{p.role} · R{p.round}</div>
                </div>
                <div className="tpp">{fmt(p.soldPrice)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function DoneScreen({ teams }: { teams: Team[] }) {
  return (
    <div>
      <div className="done">
        <div className="dtr">🏆</div>
        <div className="dtl">PARSTRIKER AUCTION COMPLETE</div>
        <p style={{color:"var(--mut)",marginBottom:36}}>All {TOTAL_ROUNDS} rounds done. Parstriker squads are locked!</p>
      </div>
      <div className="tgrid"><TeamCards teams={teams} /></div>
    </div>
  );
}
