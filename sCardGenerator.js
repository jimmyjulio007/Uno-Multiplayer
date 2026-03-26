// ============================================================================
//  UNO Card Deck Generator — Supports Classic (108) and No Mercy (168)
// ============================================================================

const COLORS = ["red", "blue", "green", "yellow"];

// ── No Mercy deck (168 cards) ───────────────────────────────────────────────
const cardsNoMercy = [];

for (const color of COLORS) {
    cardsNoMercy.push(color + "-0");
    for (let n = 1; n <= 9; n++) {
        cardsNoMercy.push(color + "-" + n);
        cardsNoMercy.push(color + "-" + n);
        cardsNoMercy.push(color + "-" + n);
    }
    cardsNoMercy.push(color + "-skip", color + "-skip");
    cardsNoMercy.push(color + "-reverse", color + "-reverse");
    cardsNoMercy.push(color + "-draw2", color + "-draw2");
    cardsNoMercy.push(color + "-draw4", color + "-draw4");
    cardsNoMercy.push(color + "-discardall");
    cardsNoMercy.push(color + "-skipeveryone");
}
for (let i = 0; i < 4; i++) {
    cardsNoMercy.push("black-reversedraw4");
    cardsNoMercy.push("black-draw6");
    cardsNoMercy.push("black-draw10");
    cardsNoMercy.push("black-colorroulette");
}

// ── Classic deck (108 cards) ────────────────────────────────────────────────
const cardsClassic = [];

for (const color of COLORS) {
    cardsClassic.push(color + "-0");
    for (let n = 1; n <= 9; n++) {
        cardsClassic.push(color + "-" + n);
        cardsClassic.push(color + "-" + n);
    }
    cardsClassic.push(color + "-skip", color + "-skip");
    cardsClassic.push(color + "-reverse", color + "-reverse");
    cardsClassic.push(color + "-draw2", color + "-draw2");
}
for (let i = 0; i < 4; i++) {
    cardsClassic.push("black-wild");
    cardsClassic.push("black-draw4");
}

// ============================================================================
//  API
// ============================================================================

function getDeckForMode(mode) {
    return (mode === "classic") ? cardsClassic : cardsNoMercy;
}

module.exports.GetCard = function (mode) {
    const deck = getDeckForMode(mode);
    return deck[Math.floor(Math.random() * deck.length)];
}

module.exports.GetCards = function (nCount, mode) {
    let result = [];
    for (let i = 0; i < nCount; i++) {
        result[i] = module.exports.GetCard(mode);
    }
    return result;
}

//////////////////////////////////////////////////////////////////////////////////////////

const mapDeckCards = new Map();

/**
 * Force reset the deck for a room (call at start of each new round).
 */
module.exports.ResetRoomDeck = function (strRoomCode, mode) {
    const deck = CreateDeck(mode);
    mapDeckCards.set(strRoomCode, deck);
}

module.exports.GetCardDeck = function (strRoomCode, mode) {
    let deck;
    if (!mapDeckCards.has(strRoomCode)) {
        deck = CreateDeck(mode);
        mapDeckCards.set(strRoomCode, deck);
    } else {
        deck = mapDeckCards.get(strRoomCode);
    }

    if (deck.length <= 0) {
        ResetDeck(deck, mode);
    }

    const r = Math.floor(Math.random() * deck.length);
    return deck.splice(r, 1)[0];
}

module.exports.GetCardsDeck = function (nCount, strRoomCode, mode) {
    let result = [];
    for (let i = 0; i < nCount; i++) {
        result[i] = module.exports.GetCardDeck(strRoomCode, mode);
    }
    return result;
}

function CreateDeck (mode) {
    const newDeck = [];
    ResetDeck(newDeck, mode);
    return newDeck;
}

function ResetDeck (deck, mode) {
    const source = getDeckForMode(mode);
    deck.length = 0;
    for (let i = 0; i < source.length; i++) {
        deck.push(source[i]);
    }
}
