// "use strict"

// Suppress console.log in production for performance
// Set to true during development to re-enable logging
const PV_DEBUG = false;
if (!PV_DEBUG) {
    console.log = function() {};
}

const socket = io();

const pv_mapUrlVariables = new Map();

// console.log (window.location);
//Generate the map

(function() {
    if (!window.location.search) { console.log ("No url parameters..."); return; }

    //Eg: ?a=1&b=2
    // console.log (window.location.search); 
    const strUrlVar =  window.location.search.substring(1);   //substring removes the '?'
    const arrayStrPairs = strUrlVar.split('&');
    // console.log (arrayStrPairs);

    for (let i = 0; i < arrayStrPairs.length; i++)
    {
        const arrSplit = arrayStrPairs[i].split ('=');
        pv_mapUrlVariables.set (arrSplit[0], arrSplit[1]);
    }

    console.log (pv_mapUrlVariables);
})();

function GetUrlValue (strKey)
{
    const ele = pv_mapUrlVariables.get (strKey);
    if (ele) { return ele; }
    else     { return ""; }
}

// Preload card images in background to avoid lag on first draw
(function() {
    const colors = ["red", "blue", "green", "yellow", "black"];
    const types = ["0","1","2","3","4","5","6","7","8","9","skip","reverse","draw2","wild","draw4",
                   "draw6","draw10","reversedraw4","skipeveryone","discardall","colorroulette","back"];
    const positions = ["bottom", "right"];
    const dir = "Game/Images/";
    const ext = ".svg";
    // Use requestIdleCallback if available, otherwise setTimeout
    const schedule = window.requestIdleCallback || ((cb) => setTimeout(cb, 200));
    schedule(() => {
        for (const pos of positions) {
            for (const col of colors) {
                for (const type of types) {
                    const img = new Image();
                    img.src = dir + pos + "-" + col + "-" + type + ext;
                }
            }
        }
    });
})();

