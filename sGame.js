/////          Public data.. Gets set in Init
let io;
let gameCache;
let mainMenuObj;

///////////////////////////////////////////////////////////////////////////////////////////////
///////////////                              Logging

// const fs = require ('fs');

// 0:None
// 1:Critical
// 2:Error
// 3:Warning
// 4:Info
// 5:Trace
const LogCritical = 1;
const LogError    = 2;
const LogWarn     = 3;
const LogInfo     = 4;
const LogTrace    = 5;

const nLogLevel = LogWarn;
// const strLogfilePath = "./Log/game.log"
// fs.writeFileSync (strLogfilePath, "");  //This is to delete the previous contents of the log file

// const logFile = fs.createWriteStream(strLogfilePath, {flags:'a'});  //flags is for append mode


function Log (level, strMessage) {
    // if (level <= nLogLevel) 
    // {
    //     let str = level + ": " + strMessage + "\n";
    //     logFile.write (str);
    // }

    if (level <= nLogLevel)
    {
        console.log (strMessage);
    }
}

///////////////////////////////////////////////////////////////////////////////////////////////

let mapRoomCodeToPlayers = new Map();
let mapSocketIdToRoomCode = new Map();

const nMaxPlayersInRoom = 8;
const nInitialCards = 7;
const nMaxRounds = 4;

const cardGenerator = require ("./sCardGenerator.js");

// Helper: get game mode for a room
function h_GetMode(strRoomCode) {
    const mv = mapRoomCodeToPlayers.get(strRoomCode);
    return (mv && mv.game && mv.game.mode) ? mv.game.mode : "nomercy";
}

//Public API
module.exports.Init = function(_io, _gameCacheObj, _mainMenuObj) {
    io = _io;
    gameCache = _gameCacheObj
    mainMenuObj = _mainMenuObj;
}

module.exports.GetGameRoom = function(strRoomCode)
{
    const val = mapRoomCodeToPlayers.get (strRoomCode);
    if (val)    return val
    else        return null;
}

module.exports.AskPlayerJoinRunningGame = function (strRoomCode, strPlayerName, strCacheId)
{
    const mapValue = mapRoomCodeToPlayers.get (strRoomCode);
    if (!mapValue) { Log(LogWarn, "AskPlayerJoinRunningGame: room code dne in map"); return; }

    const hostSocketId = mapValue.players[mapValue.hostIndex].socketId;
    io.to(hostSocketId).emit ("g_PlayerTryingToJoinActiveGame", strPlayerName, strCacheId);
}

module.exports.OnNewConnection = function (socket) {
    
    socket.on ('disconnect', () => {
        Log (LogTrace, "Disconnected: " + socket.id);
        LeaveRoom (socket);
    });

    socket.on ("g_InitJoinRoom", (strCode, strMode) => {
        InitJoinRoom (socket, strCode, strMode);
    });

    socket.on ("g_PlayerLeaveRoom", () => {
        LeaveRoom (socket);
    });

    socket.on ("g_StartNextRound", () => {
        StartNextRound (socket);
    });

    socket.on ("g_DrawCardsSelf" , (nCardsCount) => {
        AddCardsToPlayer (socket.id, nCardsCount, true);
    });

    // Draw one card at a time (player keeps clicking until playable)
    socket.on ("g_DrawOneCard", () => {
        DrawOneCard (socket);
    });

    socket.on ("g_PlayerEndTurn", (strCurrentCard, cardMeta) => {
        PlayerEndedTurn (socket, strCurrentCard, cardMeta);
    });

    socket.on ("g_DestroyRoom", (strErrorMessage) => {
        DestroyRoom (socket, strErrorMessage);
    });

    socket.on ("g_AskPlayerJoinResponse", (bJoinStatus, strCacheId) => {
        PlayerJoinRoomMidway (socket, bJoinStatus, strCacheId)
    });

    socket.on ("g_RotateClosedDeckAllPlayers", () => {
        RotateClosedDeck(socket);
    });

    socket.on ("g_UpdateThrownCardAllPlayers", (strCurrentCard, cardMeta) => {
        RotateOpenDeck(socket, strCurrentCard, cardMeta);
    });

    socket.on ("g_RemoveCardFromMyDeck", (strCard) => {
        RemoveCardFromPlayerDeck (socket.id, strCard);
    })

    //No Mercy: UNO call - player declares UNO when they have 1 card
    socket.on ("g_DeclareUno", () => {
        DeclareUno (socket);
    });

    //No Mercy: Call out a player who forgot to say UNO
    socket.on ("g_CallOutUno", (strTargetPlayerName) => {
        CallOutUno (socket, strTargetPlayerName);
    });

    //No Mercy: Challenge a +4 card (bluff detection)
    socket.on ("g_ChallengeDrawFour", () => {
        ChallengeDrawFour (socket);
    });

    //No Mercy: Accept the draw (don't challenge)
    socket.on ("g_AcceptDraw", () => {
        AcceptDraw (socket);
    });

    //No Mercy: Card 0 - swap all hands
    socket.on ("g_SwapAllHands", () => {
        SwapAllHands (socket);
    });

    //No Mercy: Card 7 - swap with chosen player
    socket.on ("g_SwapWithPlayer", (strTargetPlayerName) => {
        SwapWithPlayer (socket, strTargetPlayerName);
    });

    // Discard All — remove all cards of a color from player hand
    socket.on ("g_DiscardAll", (strColor) => {
        DiscardAll (socket, strColor);
    });

    // Color Roulette — victim picks color, draws until match
    socket.on ("g_ColorRoulette", (strChosenColor) => {
        ColorRoulette (socket, strChosenColor);
    });

    // Emoji reaction system
    socket.on ("g_SendEmoji", (strEmojiKey) => {
        SendEmoji (socket, strEmojiKey);
    });

    // Chat system
    socket.on ("g_SendChatMessage", (strMessage) => {
        SendChatMessage (socket, strMessage);
    });
}

function RemoveCardFromPlayerDeck (socketId, strCard)
{
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socketId, "RemoveCardFromPlayerDeck");
    if (nServerIndex == -1) { Log(LogWarn, "Could not rotate deck for all players"); return; }

    h_RemoveCardFromPlayer (mapValue.players[nServerIndex], strCard);
}
function RotateOpenDeck(socket, strCurrentCard, cardMeta) {
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "RotateClosedDeck");
    if (nServerIndex == -1) { Log(LogWarn, "Could not rotate deck for all players"); return; }

    socket.to(strRoomCode).emit("g_UpdateThrownCard", strCurrentCard, cardMeta);

    if (cardMeta.nCardThrown !== 0)
    {
        const nIndex = strCurrentCard.indexOf ("-");
        if (nIndex == -1) { Log(LogWarn, "RotateOpenDeck: Invalid strCurrentCard: " + strCurrentCard); return; }
        const strCardCol  = strCurrentCard.slice (0, nIndex);
        const strCardType = strCurrentCard.slice (nIndex+1, strCurrentCard.length);

        // Update top card tracking (critical for DrawUntilPlayable)
        mapValue.game.lastTopCard = strCurrentCard;
        if (cardMeta.strAdditionalCol && cardMeta.strAdditionalCol !== "") {
            mapValue.game.activeColor = cardMeta.strAdditionalCol;
        } else if (strCardCol !== "black") {
            mapValue.game.activeColor = strCardCol;
        }

        if (strCardType == "reverse" || strCardType == "reversedraw4")
        {
            mapValue.game.bClockwise = !mapValue.game.bClockwise;
            io.in (strRoomCode).emit ("g_SetPlayDirection", mapValue.game.bClockwise);
        }
    }
    else
    {
        Log (LogError, "RotateOpenDeck: meta data value might not be correct");
    }
}

function RotateClosedDeck(socket) {
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "RotateClosedDeck");
    if (nServerIndex == -1) { Log(LogWarn, "Could not rotate deck for all players"); return; }

    socket.to(strRoomCode).emit ("g_RotateClosedDeck");
}

function PlayerJoinRoomMidway (socket, bJoinStatus, strCacheId)
{
    mainMenuObj.PlayerCanJoinRoomMidway (bJoinStatus, strCacheId);
}

function DestroyRoom (socket, strErrorMessage)
{
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "DestroyRoom");
    if (nServerIndex == -1) { Log(LogWarn, "Could not destroy room"); return; }

    //display error message
    socket.to (strRoomCode).emit ("g_DisplayErrorMessage", strErrorMessage);
    io.in (strRoomCode).emit ("g_SetScoreBoardVisibility", false);
    LeaveRoom (socket);
}

///////////////////////////////////////////////////////////////////////////
////////////////////
///////////////////////////////////////////////////////////////////////////


//Helper function which is probably going to be used only once
function h_CalculateNextPlayerTurn (mapValue, strCardColor, strCardType, nCardThrown, cardMeta)
{
    //calculate index of current player in the order
    const nStringIndexCur = mapValue.game.strPlayerOrder.indexOf (mapValue.game.nTurnIndex);
    if (nStringIndexCur == -1) { Log (LogError, "PlayerEndedTurn: Couldnt find nStringIndexCur"); return; }

    //No Mercy: skipall = current player plays again
    if (cardMeta && cardMeta.bSkipAll)
    {
        return Number(mapValue.game.strPlayerOrder[nStringIndexCur]);
    }

    //Calculate who the next player is
    let nStringIndexNew = nStringIndexCur;
    nStringIndexNew += (mapValue.game.bClockwise) ? 1 : -1;

    if (nCardThrown !== 0 && strCardType == "skip")
    {
        nStringIndexNew += ((mapValue.game.bClockwise) ? 1 : -1) * nCardThrown;
    }

    //No Mercy: Reverse acts as Skip in 2-player mode (also reversedraw4)
    if (nCardThrown !== 0 && (strCardType == "reverse" || strCardType == "reversedraw4") && mapValue.count == 2)
    {
        nStringIndexNew += ((mapValue.game.bClockwise) ? 1 : -1) * nCardThrown;
    }

    //Check if it went out of bounds
    while (nStringIndexNew < 0) {
        nStringIndexNew += mapValue.count;
    }
    while (nStringIndexNew >= mapValue.count) {
        nStringIndexNew -= mapValue.count;
    }

    let nResult = Number(mapValue.game.strPlayerOrder[nStringIndexNew]);

    // No Mercy: Skip eliminated players — find next alive player
    const dir = (mapValue.game.bClockwise) ? 1 : -1;
    let safety = 0;
    while (mapValue.players[nResult] && mapValue.players[nResult].eliminated && safety < mapValue.count) {
        nStringIndexNew += dir;
        while (nStringIndexNew < 0) nStringIndexNew += mapValue.count;
        while (nStringIndexNew >= mapValue.count) nStringIndexNew -= mapValue.count;
        nResult = Number(mapValue.game.strPlayerOrder[nStringIndexNew]);
        safety++;
    }

    return nResult;
}

function h_RemoveCardFromPlayer (player, strCard)
{
    const cards = player.cards;
    for (let i = 0; i < cards.length; i++)
    {
        if (cards[i] == strCard)
        {
            cards.splice (i, 1);
            return true;
        }
    }
    return false;
}

function h_PlayerWonRound (strRoomCode, mapValue, nServerIndex)
{
    const playerData = mapValue.players[nServerIndex];
    playerData.winCount += 1;
    mapValue.game.bRoundStarted = false;

    io.in (strRoomCode).emit ("g_SetScoreBoardVisibility", true);
    // const hostSocketId = mapValue.players[mapValue.hostIndex].socketId;
    
    UpdateScoreBoard (strRoomCode);
}

function PlayerEndedTurn (socket, strCurrentCard, cardMeta)
{
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "PlayerEndedTurn");
    if (nServerIndex == -1) { return; }

    // Block eliminated players from acting
    if (mapValue.players[nServerIndex].eliminated) { return; }

    //validate the cardMeta
    if (!cardMeta || !cardMeta.hasOwnProperty ("nCardThrown")) { Log (LogCritical, "Invalid meta data received from client"); return; }

    //validate strCurrentCard
    const nIndex = strCurrentCard.indexOf ("-");
    if (nIndex == -1) { Log(LogWarn, "PlayerEndedTurn: Invalide strCurrentCard: " + strCurrentCard); return; }

    const strCardCol  = strCurrentCard.slice (0, nIndex);
    const strCardType = strCurrentCard.slice (nIndex+1, strCurrentCard.length);
    
    if (!strCardCol || !strCardType) { Log(LogWarn, "PlayerEndedTurn: Invalid strCurrentCard2: " + strCurrentCard); return; }

    //Programming error occured
    if (mapValue.count != mapValue.game.strPlayerOrder.length) {Log(LogWarn, "PlayerEndedTurn: Invalid player count or strPlayerOrder: " + mapValue.count + ".." + mapValue.game.strPlayerOrder); return;}

    //Safety checks over... ?

    //To do: temp.. delete 
    if (strCardCol != strCardCol.toLowerCase() || strCardType != strCardType.toLowerCase())
    {
        //Programming error
        console.log ("This is very very bad!!..... It should be lower case: " + strCardCol + "-" + strCardType);
        return;
    }

    //There now exists a seperate signal which the player sends when they throw a card.. The open deck card rotates when that signal is received.. A seperate signal was added so that when the feature is added to keep throwing the same number, the other players can see all the cards that were thrown
    // socket.to(strRoomCode).emit("g_UpdateThrownCard", strCurrentCard, cardMeta);
    
    //Update the current card for the other players
    // if (cardMeta.nCardThrown !== 0)
    // {
    //     //reverse the direction before calculating who the next player is (Reverse only if that card was thrown and if there are an odd number of reverses that were thrown)
    //     if (strCardType == "reverse" && (cardMeta.nCardThrown % 2 == 1))
    //     {
    //         mapValue.game.bClockwise = !mapValue.game.bClockwise;
    //         io.in (strRoomCode).emit ("g_SetPlayDirection", mapValue.game.bClockwise);
    //     }

    //     //There is now a seperate signal to update the players deck when the player throws a card (g_RemoveCardFromMyDeck)... 
    //     // h_RemoveCardFromPlayer (mapValue.players[nServerIndex], strCurrentCard);
    // }

    //Update all the other players now that the current player has picked a card/thrown a card.. Must be done after h_RemoveCardFromPlayer()
    const playerData = mapValue.players[nServerIndex];
    {
        const cardsArray = playerData.cards;
        let cardsData = [];
        for (let i = 0; i < cardsArray.length; i++)
        {
            cardsData.push("black-back");
        }
        // console.log ("Updating other players");
        socket.to (strRoomCode).emit ("g_UpdateOtherPlayerCards", playerData.name, cardsData);
    }

    //Check if the current player who threw a card won the round
    {
        if (playerData.cards.length === 0)
        {
            // Must have said UNO before playing last card!
            const unoSet = mapUnoDeclarations.get(strRoomCode);
            const bSaidUno = unoSet && unoSet.has(playerData.name);

            if (bSaidUno) {
                // Valid win!
                console.log("Player won: " + playerData.name);
                h_PlayerWonRound(strRoomCode, mapValue, nServerIndex);
                return; // Game over for this round
            } else {
                // Didn't say UNO before last card → penalty +2, NOT a win!
                console.log("BLOCKED WIN: " + playerData.name + " didn't say UNO! +2 penalty");
                let penCards = cardGenerator.GetCardsDeck(2, strRoomCode, h_GetMode(strRoomCode));
                for (let i = 0; i < 2; i++) playerData.cards.push(penCards[i]);

                let penData = { name: playerData.name, winCount: playerData.winCount, cards: playerData.cards };
                io.to(playerData.socketId).emit("g_UpdateSelfCardsCount_NoAutoEnd", penData);

                let backs = playerData.cards.map(() => "black-back");
                socket.to(strRoomCode).emit("g_UpdateOtherPlayerCards", playerData.name, backs);

                io.in(strRoomCode).emit("g_AutoUnoPenalty", playerData.name);
                // Game continues — player now has 2 cards
            }
        }
    }

    // Clean UNO declarations after checking
    h_CleanUnoDeclarations(strRoomCode, playerData.name);

    const bIsDrawFour = (strCardType === "draw4" || strCardType === "reversedraw4");
    // No Mercy only: store draw4 info for challenge system
    if (cardMeta.nCardThrown !== 0 && bIsDrawFour && h_GetMode(strRoomCode) === "nomercy")
    {
        h_StoreDrawFourInfo(strRoomCode, nServerIndex, cardMeta._prevCardColor || "", cardMeta.strAdditionalCol || "");
    }

    // No Mercy only: 2-player Reverse+4 special — YOU (the player) draw 4, not opponent!
    // PDF: "l'adversaire passe son tour et le joueur AYANT POSE la carte pige 4 cartes"
    if (strCardType === "reversedraw4" && mapValue.count === 2 && cardMeta.nCardThrown !== 0 && h_GetMode(strRoomCode) === "nomercy")
    {
        // The player who played it draws 4
        let selfCards = cardGenerator.GetCardsDeck(4, strRoomCode, h_GetMode(strRoomCode));
        for (let i = 0; i < 4; i++) playerData.cards.push(selfCards[i]);

        let selfData = { name: playerData.name, winCount: playerData.winCount, cards: playerData.cards };
        io.to(playerData.socketId).emit("g_UpdateSelfCardsCount_NoAutoEnd", selfData);

        let selfBacks = playerData.cards.map(() => "black-back");
        for (let k = 0; k < mapValue.count; k++) {
            if (k !== nServerIndex) io.to(mapValue.players[k].socketId).emit("g_UpdateOtherPlayerCards", playerData.name, selfBacks);
        }

        console.log("2-PLAYER REVERSE+4: " + playerData.name + " drew 4 cards (self-penalty)");

        // Notify all players about this special rule
        io.in(strRoomCode).emit("g_SpecialRuleNotify", playerData.name + " a joue Reverse+4 en 2 joueurs — il pioche 4 lui-meme!");

        // The player can use stacking to redirect: set stack on SELF
        cardMeta.nForceDraw = 4;
        cardMeta.nForceDrawValue = 4;

        // Turn stays on the same player — they can stack to redirect
        mapValue.game.nTurnIndex = nServerIndex;
        cardMeta.bSkipAll = false;
        cardMeta.bCanChallenge = false;

        // Check elimination
        h_CheckElimination(strRoomCode, mapValue, nServerIndex);

        mapValue.game.lastTopCard = strCurrentCard;
        mapValue.game.activeColor = (cardMeta.strAdditionalCol && cardMeta.strAdditionalCol !== "")
            ? cardMeta.strAdditionalCol : strCardCol;

        io.in(strRoomCode).emit("g_StartTurn", playerData.name, cardMeta);
        return;
    }

    const nNextPlayerIndex = h_CalculateNextPlayerTurn (mapValue, strCardCol, strCardType, cardMeta.nCardThrown, cardMeta);
    mapValue.game.nTurnIndex = nNextPlayerIndex;
    console.log("[TURN] " + playerData.name + " played " + strCurrentCard + " → next: " + mapValue.players[nNextPlayerIndex].name + " | stack:" + cardMeta.nForceDrawValue + " mode:" + (mapValue.game.mode || "?"));

    //Reset bSkipAll after calculating next turn
    cardMeta.bSkipAll = false;

    // No Mercy only: draw4/reversedraw4 → allow challenge
    if (cardMeta.nCardThrown !== 0 && bIsDrawFour && h_GetMode(strRoomCode) === "nomercy")
    {
        cardMeta.bCanChallenge = true;
    }

    // Store current top card info for DrawUntilPlayable
    mapValue.game.lastTopCard = strCurrentCard;
    mapValue.game.activeColor = (cardMeta.strAdditionalCol && cardMeta.strAdditionalCol !== "")
        ? cardMeta.strAdditionalCol : strCardCol;

    //Start the next players turn
    io.in (strRoomCode).emit ("g_StartTurn", mapValue.players[nNextPlayerIndex].name, cardMeta);

    // No Mercy: If colorroulette was played, tell the next player to pick a color
    if (strCardType === "colorroulette") {
        io.to(mapValue.players[nNextPlayerIndex].socketId).emit("g_ColorRouletteStart");
    }
} 


///////////////////////////////////////////////////////////////////////////
////////////////////
///////////////////////////////////////////////////////////////////////////





function AddCardsToPlayer(socketId, nCardsCount, bUpdatePlayer)
{
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socketId, "AddCardsToPlayer");
    if (nServerIndex == -1) { return; }

    let newCards = cardGenerator.GetCardsDeck (nCardsCount, strRoomCode, h_GetMode(strRoomCode));
    const player = mapValue.players[nServerIndex];
    for (let i = 0; i < nCardsCount; i++)
    {
        player.cards.push (newCards[i]);
    }

    if (bUpdatePlayer)
    {
        data = new Object();
        data.name = player.name;
        data.winCount = player.winCount;
        data.cards = player.cards;
        io.to(socketId).emit ("g_UpdateSelfCardsCount", data);
    }

    // No Mercy: Check elimination at 25+ cards
    h_CheckElimination(strRoomCode, mapValue, nServerIndex);
}

function StartNextRound (socket) {

    const strRoomCode = mapSocketIdToRoomCode.get (socket.id);
    if (!strRoomCode) { Log (LogWarn, "Socket does not exist in map while starting next round"); return; }
    
    const mapValue = mapRoomCodeToPlayers.get (strRoomCode);
    if (!mapValue) { Log (LogWarn, "room does not exist in player map while starting next round"); return; }
    
    if (mapValue.game.bRoundStarted === true) { Log (LogWarn, "Cannot start round... Round is already started"); return; }

    //Generate starting card
    let strStartingCard;
    {
        let bIsValid = false;
        for (let nAttempts = 0; nAttempts < 25 && !bIsValid; nAttempts++)
        {
            strStartingCard = cardGenerator.GetCard(h_GetMode(strRoomCode));
            const nIndex = strStartingCard.indexOf ("-");
            if (nIndex == -1) { continue; }

            const strColor = strStartingCard.slice(0, nIndex);
            const strType = strStartingCard.slice(nIndex+1, strStartingCard.length);

            if (strColor == "black") { continue; }
            // Exclude all action/special cards — only number cards can start
            if (strType != "0" && strType != "1" && strType != "2" && strType != "3" &&
                strType != "4" && strType != "5" && strType != "6" && strType != "7" &&
                strType != "8" && strType != "9") { continue; }

            bIsValid = true;
        }
        if (!bIsValid) { Log (LogWarn, "Cannot start round... Could not calculate starting card"); return; }
    }
    mapValue.game.bRoundStarted = true;
    mapUnoDeclarations.delete(strRoomCode);
    mapDrawFourInfo.delete(strRoomCode);

    // Reset all players for new round
    for (let i = 0; i < mapValue.count; i++) {
        mapValue.players[i].eliminated = false;
        mapValue.players[i].cards = [];
    }
    mapValue.game.bClockwise = true;

    // Fresh shuffled deck for the new round
    cardGenerator.ResetRoomDeck(strRoomCode, h_GetMode(strRoomCode));

    // Randomize positions, who starts, and deal new cards
    UpdatePlayerNum (strRoomCode, nInitialCards, true);

    io.in(strRoomCode).emit("g_StartNextRoundSuccess", strStartingCard);

    // Initialize top card tracking for DrawUntilPlayable
    mapValue.game.lastTopCard = strStartingCard;
    const _startIdx = strStartingCard.indexOf("-");
    mapValue.game.activeColor = strStartingCard.slice(0, _startIdx);

    mapValue.game.nTurnIndex = Number(mapValue.game.strPlayerOrder[0]);   //The person who starts the game
    Log (LogTrace, "Player will start: " + mapValue.game.nTurnIndex);
    const turnPlayer = mapValue.players[mapValue.game.nTurnIndex];

    io.in (strRoomCode).emit ("g_StartTurn", turnPlayer.name, {nForceDraw: 0, nForceDrawValue: 0, strAdditionalCol: "", bSkipAll: false, bCanChallenge: false});
}

function LeaveRoom (socket) {
    Log (LogTrace, "Leaving:" + socket.id);

    const {roomCode: strRoomCode, mapValue: mapPlayers, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "LeaveRoom");
    if (nServerIndex == -1) { return; }

    //Remove socket from the socket map
    mapSocketIdToRoomCode.delete (socket.id);

    //Remove socket from the players map
    mapPlayers.count -= 1;
    mapPlayers.players.splice (nServerIndex, 1);
    socket.leave (strRoomCode);

    if (mapPlayers.hostIndex == nServerIndex)
    {
        //The host left... Calculate/set a new host
        mapPlayers.hostIndex = 0; //It could be random but just set it to 0 for simplicity
    }

    if (mapPlayers.count == 0)
    {
        //All players left.. Delete from map and clean up all room state
        mapRoomCodeToPlayers.delete (strRoomCode);
        mapUnoDeclarations.delete (strRoomCode);
        mapDrawFourInfo.delete (strRoomCode);
    }
    else
    {
        mapPlayers.game.strPlayerOrder =  RemovePlayerFromOrder (mapPlayers.game.strPlayerOrder, nServerIndex);
        if (mapPlayers.game.bRoundStarted)
        {
            //Recalculate the current players turn
            // const rand = Math.floor (Math.random() * mapPlayers.game.strPlayerOrder.length);
            const nNextTurn = Number(mapPlayers.game.strPlayerOrder[0])
            mapPlayers.game.nTurnIndex = nNextTurn;

            io.in (strRoomCode).emit ("g_StartTurn", mapPlayers.players[nNextTurn].name, {nForceDraw: 0, nForceDrawValue: 0, strAdditionalCol: "", bSkipAll: false, bCanChallenge: false});
        }

        UpdatePlayerNum (strRoomCode, -1, false);  //Player couldve left while the game is ongoing... Preserve cards and preserve order
        UpdateScoreBoard (strRoomCode);     //Player couldve left while the scoreboard is displayed
    }
}

function InitJoinRoom (socket, strCode, strMode) {
    Log (LogTrace, "InitJoinRoom: " + strCode);

    //To do: Calculate this value from strCode
    const cacheVal = gameCache.GetPlayerCache (strCode);
    if (!cacheVal) { 
        Log (LogWarn, "Id does not exist in gameCache: " + strCode); 
        socket.emit ("g_InitJoinRoomFailure", "Error: Invalid id");
        return; 
    }

    let strRoomCode = cacheVal.strRoomCode;
    let strPlayerName = cacheVal.strPlayerName;
    let bIsHost = cacheVal.bIsHost;

    const nPlayerWins = 0;
    let mapValue = mapRoomCodeToPlayers.get (strRoomCode);

    if (!mapValue) {
        //Create the object and insert it into the map
        mapValue = new Object ();
        mapValue.players = [];
        mapValue.count = 0;
        
        //Game properties
        mapValue.game = new Object ();

        mapValue.game.bRoundStarted = false;
        mapValue.game.strPlayerOrder = "";
        mapValue.game.nTurnIndex = 0;
        mapValue.game.bClockwise = true;
        mapValue.game.lastTopCard = "";
        mapValue.game.activeColor = "";
        mapValue.game.mode = (strMode === "classic") ? "classic" : "nomercy";

        //This exists when the host joins the room
        // mapValue.hostIndex = false;  
        mapRoomCodeToPlayers.set (strRoomCode, mapValue);
    }
    else
    {
        
        //The room already exists
        if (mapValue.game.bRoundStarted)
        {
            //The player cannot join while the round is ongoing... The player should not have reached to game.html while the round is ongoing... Logical error
            Log (LogCritical, "Fatal Error: A player joined a room while it was ongoing... Logical error");
            socket.emit ("g_InitJoinRoomFailure", "Cannot join room. The round has already started");
            return;
        }
    }

    let nPlayerIndex = mapValue.count;
    if (nPlayerIndex >= nMaxPlayersInRoom) {
        Log (LogWarn, "InitJoinRoom: Room is full (" + nPlayerIndex + "/" + nMaxPlayersInRoom + ")");
        socket.emit ("g_InitJoinRoomFailure", "La room est pleine");
        return;
    }

     //Success
     socket.join (strRoomCode);
     socket.emit ("g_InitJoinRoomSuccess");

    mapValue.players[nPlayerIndex] = { name: strPlayerName, socketId: socket.id, winCount: nPlayerWins, eliminated: false };
    mapValue.players[nPlayerIndex].cards = [];
    mapValue.count += 1;
    
    if (bIsHost)
    {
        mapValue.hostIndex = nPlayerIndex;
    }

    mapSocketIdToRoomCode.set (socket.id, strRoomCode);

    //Player can join only when the scoreboard is shown, so it isnt necessary to update the players (only the scoreboard)
    // UpdatePlayerNum (strRoomCode, -1, true);
    UpdateScoreBoard (strRoomCode);
}

function UpdateScoreBoard(strRoomCode)
{
    let mapValue = mapRoomCodeToPlayers.get(strRoomCode);
    if (!mapValue) return;

    //Check if any player won
    let nPlayerWonIndex = -1;
    let nPlayerWonName = "";
    for (let i = 0; i < mapValue.count; i++)
    {
        if (mapValue.players[i].winCount >= nMaxRounds)
        {
            nPlayerWonIndex = i;
            nPlayerWonName = mapValue.players[i].name;
            break;
        }
    }

    const data = GenerateScoreBoardData (mapValue);
    if (data)
    {
        io.in(strRoomCode).emit("g_UpdateScoreBoard", data, strRoomCode);
        io.in(strRoomCode).emit("g_UpdateScoreBoard_HideBtn");  //Hide the Next Round Btn
        
        //To do: change 0 to 1 so that you need atleast two players to start the next round 
        if (data.count > 0 && mapValue.hasOwnProperty("hostIndex"))
        {
            //Only host can start the next round
            const hostPlayer = mapValue.players[mapValue.hostIndex];
            if (hostPlayer)
            {
                io.to(hostPlayer.socketId).emit("g_UpdateScoreBoard_ShowBtn", nPlayerWonName);
            }
        }
    }

}
////////////////////////////////////////////////////////////////////////////////////////
////////////////                  Update Player Num (For when a new player joins or leaves)  

//If nGenerateCards == -1, Cards are preserved and unmodified
//If nGenerateCards == 0, Cards are delete
//If nGenerateCards > 0,  the number of cards passed are generated for each player


function UpdatePlayerNum (strRoomCode, nGenerateCards, bRandomizeOrder) {
    let mapValue = mapRoomCodeToPlayers.get (strRoomCode);
    if (!mapValue) { Log(LogWarn, "Room code does not exist in the map in UpdatePlayerNum: " + strRoomCode); return; }

    if (bRandomizeOrder === true)
    {
        mapValue.game.strPlayerOrder = GeneratePlayerOrder(mapValue.count);
    }
    else if (bRandomizeOrder === false)
    {
        //Dont randomize order
        // strPlayerOrder = GeneratePlayerOrderNonRandom (mapValue.count, mapValue.game.strPlayerOrder);
    }
    else { Log(LogWarn, "UpdatePlayerNum: second parameter should be a boolean: " + bRandomizeOrder + "..." + typeof(bRandomizeOrder)); return; }
    
    //Generate cards if need be
    if (nGenerateCards >= 0)
    {
        for (let i = 0; i < mapValue.count; i++) {
            let curPlayer = mapValue.players[i];
            if (curPlayer) { 
                curPlayer.cards = cardGenerator.GetCardsDeck (nGenerateCards, strRoomCode, h_GetMode(strRoomCode));
            }
        }
    }

    for (let i = 0; i < mapValue.count; i++)
    {
        let curPlayer = mapValue.players[i];
        if (!curPlayer) { Log (LogWarn, "Player does not exist in the map"); continue; }

        let strSocketId = curPlayer.socketId;
        let generatedData = GenerateUpdatePlayerData(mapValue, i);
        io.to(strSocketId).emit ("g_UpdatePlayerNum", mapValue.game.strPlayerOrder, i, generatedData);
    }
}



function GeneratePlayerOrder (nPlayerCount)
{
    let orders = [];
    for (let i = 0; i < nPlayerCount; i++)
    {
        orders[i] = i;
    }

    let strOrder = "";
    for (let i = 0; i < nPlayerCount; i++) {
        let r = Math.floor(Math.random() * orders.length);
        strOrder += orders[r].toString();
        orders.splice(r, 1);
    }

    return strOrder;
}

//Recalculates the strPlayerOrder in the event that a player leaves midgame... This preserves the order of the 
function RemovePlayerFromOrder (strPlayerOrder, leftIndex)
{
    let strOrder = "";
    for (let i = 0; i < strPlayerOrder.length; i++)
    {
        let r = Number(strPlayerOrder[i]);
        if (r < leftIndex)
        {
            strOrder += r.toString();
        }
        else if (r > leftIndex)
        {
            strOrder += (r-1).toString();
        }
        //If it is equal then that player left and does not need to be in the order anymore... The people higher than him will be shifted to the left in the players array and their server index will decrease by 1.
    }

    return strOrder;
}

//Generates the player data to send to the client... All the players except the receiver client have their cards set to back ( so the client does not receive the value of the cards)
//Return Value:
//      int count
//      players:
//          string name
//          int winCount
//          array(strings) cards:

function GenerateUpdatePlayerData (mapValue, index)
{
    let retValue = new Object();
    retValue.players = [];
    retValue.count = mapValue.count;
    for (let i = 0; i < mapValue.count; i++)
    {
        let curPlayer = mapValue.players[i];
        retValue.players[i] = { name: curPlayer.name, winCount: curPlayer.winCount };
        retValue.players[i].cards = [];
        if (i == index)
        {
            for (let j = 0; j < curPlayer.cards.length; j++)
            {
                retValue.players[i].cards[j] = curPlayer.cards[j];
            }
        }
        else
        {
            for (let j = 0; j < curPlayer.cards.length; j++)
            {
                retValue.players[i].cards[j] = "black-back";
            }
        }
    }
    return retValue;
}

//Generates the player data to send to the client... This is mainly for updating the scoreboard so the cards are not calculated
//Return Value:
//      int count
//      players:
//          string name
//          int winCount

function GenerateScoreBoardData (mapValue) {
    const returnVal = new Object();
    returnVal.count = mapValue.count;
    returnVal.players = [];
    
    for (let i = 0; i < mapValue.count; i++)
    {
        const curPlayer = mapValue.players[i];
        returnVal.players[i] = { name: curPlayer.name, winCount: curPlayer.winCount };
    }
    
    return returnVal;
}







///////////////////////////////////////////////////////////////////////////
////////////////////    No Mercy Features
///////////////////////////////////////////////////////////////////////////

// Track which players have declared UNO (keyed by room code -> set of player names)
let mapUnoDeclarations = new Map();

function DeclareUno (socket)
{
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "DeclareUno");
    if (nServerIndex == -1) { return; }

    const player = mapValue.players[nServerIndex];
    const playerName = player.name;

    // Validate: player must have exactly 1 card to say UNO
    if (player.cards.length === 1) {
        // Valid UNO!
        if (!mapUnoDeclarations.has(strRoomCode)) {
            mapUnoDeclarations.set(strRoomCode, new Set());
        }
        mapUnoDeclarations.get(strRoomCode).add(playerName);
        console.log("UNO valid: " + playerName);
        io.in(strRoomCode).emit("g_PlayerDeclaredUno", playerName, true);
    } else {
        // False UNO — penalty +2!
        console.log("FALSE UNO: " + playerName + " has " + player.cards.length + " cards! +2 penalty");
        let penaltyCards = cardGenerator.GetCardsDeck(2, strRoomCode, h_GetMode(strRoomCode));
        for (let i = 0; i < 2; i++) player.cards.push(penaltyCards[i]);

        // Update penalized player's hand
        let data = { name: player.name, winCount: player.winCount, cards: player.cards };
        io.to(socket.id).emit("g_UpdateSelfCardsCount_NoAutoEnd", data);

        // Update others
        let backs = player.cards.map(() => "black-back");
        socket.to(strRoomCode).emit("g_UpdateOtherPlayerCards", player.name, backs);

        io.in(strRoomCode).emit("g_PlayerDeclaredUno", playerName, false);
    }
}

function CallOutUno (socket, strTargetPlayerName)
{
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "CallOutUno");
    if (nServerIndex == -1) { return; }

    // Find the target player
    let nTargetIndex = -1;
    for (let i = 0; i < mapValue.count; i++) {
        if (mapValue.players[i].name === strTargetPlayerName) {
            nTargetIndex = i;
            break;
        }
    }
    if (nTargetIndex == -1) { Log(LogWarn, "CallOutUno: target player not found: " + strTargetPlayerName); return; }

    const targetPlayer = mapValue.players[nTargetIndex];

    // Check if the target player has exactly 1 card and did NOT declare UNO
    const unoSet = mapUnoDeclarations.get(strRoomCode);
    const bDeclaredUno = unoSet && unoSet.has(strTargetPlayerName);

    if (targetPlayer.cards.length === 1 && !bDeclaredUno)
    {
        // Official No Mercy penalty: 2 cards
        Log(LogInfo, "UNO call-out successful! " + strTargetPlayerName + " draws 2 cards");
        let newCards = cardGenerator.GetCardsDeck(2, strRoomCode, h_GetMode(strRoomCode));
        for (let i = 0; i < 2; i++) {
            targetPlayer.cards.push(newCards[i]);
        }

        // Update the target player's cards
        let data = new Object();
        data.name = targetPlayer.name;
        data.winCount = targetPlayer.winCount;
        data.cards = targetPlayer.cards;
        io.to(targetPlayer.socketId).emit("g_UpdateSelfCardsCount", data);

        // Update other players about the target's card count
        let cardsData = [];
        for (let i = 0; i < targetPlayer.cards.length; i++) {
            cardsData.push("black-back");
        }
        socket.to(strRoomCode).emit("g_UpdateOtherPlayerCards", targetPlayer.name, cardsData);

        io.in(strRoomCode).emit("g_UnoCallOutResult", strTargetPlayerName, true, mapValue.players[nServerIndex].name);
    }
    else
    {
        // False call-out
        Log(LogInfo, "UNO call-out failed (player had declared or has != 1 card)");
        io.in(strRoomCode).emit("g_UnoCallOutResult", strTargetPlayerName, false, mapValue.players[nServerIndex].name);
    }
}

// Track the last +4 player info for challenge purposes
// mapRoomCode -> { playerIndex, previousCardColor, previousCardType }
let mapDrawFourInfo = new Map();

function ChallengeDrawFour (socket)
{
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "ChallengeDrawFour");
    if (nServerIndex == -1) { return; }

    const drawFourInfo = mapDrawFourInfo.get(strRoomCode);
    if (!drawFourInfo) {
        Log(LogWarn, "ChallengeDrawFour: no draw4 info found");
        return;
    }

    const challengerName = mapValue.players[nServerIndex].name;
    const accusedPlayer = mapValue.players[drawFourInfo.playerIndex];

    if (!accusedPlayer) { Log(LogWarn, "ChallengeDrawFour: accused player not found"); return; }

    // Check if the accused player had a card of the previous color (meaning they bluffed)
    const prevColor = drawFourInfo.previousCardColor;
    let bWasBluffing = false;

    for (let i = 0; i < accusedPlayer.cards.length; i++) {
        const nDash = accusedPlayer.cards[i].indexOf("-");
        if (nDash == -1) continue;
        const cardCol = accusedPlayer.cards[i].slice(0, nDash);
        if (cardCol === prevColor) {
            bWasBluffing = true;
            break;
        }
    }

    if (bWasBluffing)
    {
        // Bluff detected! The accused player draws 6 cards
        Log(LogInfo, "Challenge successful! " + accusedPlayer.name + " was bluffing, draws 6");
        let newCards = cardGenerator.GetCardsDeck(6, strRoomCode, h_GetMode(strRoomCode));
        for (let i = 0; i < 6; i++) {
            accusedPlayer.cards.push(newCards[i]);
        }

        let data = new Object();
        data.name = accusedPlayer.name;
        data.winCount = accusedPlayer.winCount;
        data.cards = accusedPlayer.cards;
        io.to(accusedPlayer.socketId).emit("g_UpdateSelfCardsCount", data);

        // Notify everyone
        io.in(strRoomCode).emit("g_ChallengeResult", challengerName, accusedPlayer.name, true);

        // Challenger doesn't draw, their turn continues normally
        io.in(strRoomCode).emit("g_StartTurn", challengerName, {nForceDraw: 0, nForceDrawValue: 0, strAdditionalCol: "", bSkipAll: false});
    }
    else
    {
        // Challenge failed! Challenger draws 6 cards
        Log(LogInfo, "Challenge failed! " + challengerName + " draws 6");
        const challengerPlayer = mapValue.players[nServerIndex];
        let newCards = cardGenerator.GetCardsDeck(6, strRoomCode, h_GetMode(strRoomCode));
        for (let i = 0; i < 6; i++) {
            challengerPlayer.cards.push(newCards[i]);
        }

        let data = new Object();
        data.name = challengerPlayer.name;
        data.winCount = challengerPlayer.winCount;
        data.cards = challengerPlayer.cards;
        io.to(socket.id).emit("g_UpdateSelfCardsCount", data);

        io.in(strRoomCode).emit("g_ChallengeResult", challengerName, accusedPlayer.name, false);

        // Move to the next player (challenger's turn is over, they drew 6)
        const nNextIndex = h_CalculateNextPlayerTurn(mapValue, "", "", 0, null);
        mapValue.game.nTurnIndex = nNextIndex;
        io.in(strRoomCode).emit("g_StartTurn", mapValue.players[nNextIndex].name, {nForceDraw: 0, nForceDrawValue: 0, strAdditionalCol: drawFourInfo.strAdditionalCol || "", bSkipAll: false});
    }

    mapDrawFourInfo.delete(strRoomCode);
}

function AcceptDraw (socket)
{
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "AcceptDraw");
    if (nServerIndex == -1) { return; }

    mapDrawFourInfo.delete(strRoomCode);
    // The normal draw flow handles this - the player will click the deck to draw
}

function SwapAllHands (socket)
{
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "SwapAllHands");
    if (nServerIndex == -1) { return; }

    if (mapValue.count < 2) { return; }

    Log(LogInfo, "No Mercy: Card 0 played - swapping all hands (clockwise rotation)");

    // Rotate hands in the current play direction
    const order = mapValue.game.strPlayerOrder;
    const tempCards = [];

    // Save all hands
    for (let i = 0; i < order.length; i++) {
        const idx = Number(order[i]);
        tempCards[i] = mapValue.players[idx].cards.slice();
    }

    // Rotate: each player gets the previous player's hand
    for (let i = 0; i < order.length; i++) {
        const idx = Number(order[i]);
        let sourceIdx;
        if (mapValue.game.bClockwise) {
            sourceIdx = (i - 1 + order.length) % order.length;
        } else {
            sourceIdx = (i + 1) % order.length;
        }
        mapValue.players[idx].cards = tempCards[sourceIdx];
    }

    // Send updated cards to all players
    for (let i = 0; i < mapValue.count; i++) {
        const player = mapValue.players[i];
        // Send real cards to the player themselves
        let selfData = new Object();
        selfData.name = player.name;
        selfData.winCount = player.winCount;
        selfData.cards = player.cards;
        io.to(player.socketId).emit("g_UpdateSelfCardsCount_NoAutoEnd", selfData);

        // Send card backs to every OTHER player (not to themselves)
        let cardsBack = [];
        for (let j = 0; j < player.cards.length; j++) cardsBack.push("black-back");
        for (let k = 0; k < mapValue.count; k++) {
            if (k === i) continue; // skip self
            io.to(mapValue.players[k].socketId).emit("g_UpdateOtherPlayerCards", player.name, cardsBack);
        }
    }

    io.in(strRoomCode).emit("g_SwapAllHandsNotify");
}

function SwapWithPlayer (socket, strTargetPlayerName)
{
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "SwapWithPlayer");
    if (nServerIndex == -1) { return; }

    // Find target player
    let nTargetIndex = -1;
    for (let i = 0; i < mapValue.count; i++) {
        if (mapValue.players[i].name === strTargetPlayerName) {
            nTargetIndex = i;
            break;
        }
    }
    if (nTargetIndex == -1) { Log(LogWarn, "SwapWithPlayer: target not found"); return; }
    if (nTargetIndex == nServerIndex) { Log(LogWarn, "SwapWithPlayer: cannot swap with yourself"); return; }

    Log(LogInfo, "No Mercy: Card 7 - " + mapValue.players[nServerIndex].name + " swaps with " + strTargetPlayerName);

    // Swap hands
    const tempCards = mapValue.players[nServerIndex].cards;
    mapValue.players[nServerIndex].cards = mapValue.players[nTargetIndex].cards;
    mapValue.players[nTargetIndex].cards = tempCards;

    // Update both players with their new hands
    const sourcePlayer = mapValue.players[nServerIndex];
    const targetPlayer = mapValue.players[nTargetIndex];

    // Update source player
    {
        let data = new Object();
        data.name = sourcePlayer.name;
        data.winCount = sourcePlayer.winCount;
        data.cards = sourcePlayer.cards;
        io.to(sourcePlayer.socketId).emit("g_UpdateSelfCardsCount_NoAutoEnd", data);
    }
    // Update target player
    {
        let data = new Object();
        data.name = targetPlayer.name;
        data.winCount = targetPlayer.winCount;
        data.cards = targetPlayer.cards;
        io.to(targetPlayer.socketId).emit("g_UpdateSelfCardsCount_NoAutoEnd", data);
    }

    // Update all players about card counts — send backs to everyone EXCEPT the card owner
    for (let i = 0; i < mapValue.count; i++) {
        const player = mapValue.players[i];
        let cardsBack = [];
        for (let j = 0; j < player.cards.length; j++) cardsBack.push("black-back");
        for (let k = 0; k < mapValue.count; k++) {
            if (k === i) continue;
            io.to(mapValue.players[k].socketId).emit("g_UpdateOtherPlayerCards", player.name, cardsBack);
        }
    }

    io.in(strRoomCode).emit("g_SwapWithPlayerNotify", sourcePlayer.name, targetPlayer.name);
}

// Store draw4 info when a draw4 is played (called from PlayerEndedTurn)
function h_StoreDrawFourInfo (strRoomCode, nPlayerIndex, strPrevColor, strAdditionalCol)
{
    mapDrawFourInfo.set(strRoomCode, {
        playerIndex: nPlayerIndex,
        previousCardColor: strPrevColor,
        strAdditionalCol: strAdditionalCol
    });
}

// Clean up UNO declarations when a new round starts or card is played
function h_CleanUnoDeclarations (strRoomCode, strPlayerName)
{
    const unoSet = mapUnoDeclarations.get(strRoomCode);
    if (unoSet) {
        unoSet.delete(strPlayerName);
    }
}

// Emoji reaction - broadcast to all players in room
const validEmojis = new Set(["laugh", "rage", "skull", "fire", "clown"]);

function SendEmoji (socket, strEmojiKey)
{
    if (!validEmojis.has(strEmojiKey)) return;

    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "SendEmoji");
    if (nServerIndex == -1) { return; }

    const playerName = mapValue.players[nServerIndex].name;
    io.in(strRoomCode).emit("g_ReceiveEmoji", playerName, strEmojiKey);
}

// Chat — broadcast message to all players in room
///////////////////////////////////////////////////////////////////////////
//// Draw One Card (1 at a time — player keeps clicking until playable)
///////////////////////////////////////////////////////////////////////////

/**
 * Check if a card string is playable on the current game state.
 */
function h_IsCardPlayable(cardStr, topCard, activeColor) {
    if (!cardStr || !topCard) return false;
    const idx = cardStr.indexOf("-");
    if (idx === -1) return false;
    const col = cardStr.slice(0, idx);
    const typ = cardStr.slice(idx + 1);

    const tIdx = topCard.indexOf("-");
    const topCol = tIdx !== -1 ? topCard.slice(0, tIdx) : "";
    const topType = tIdx !== -1 ? topCard.slice(tIdx + 1) : "";

    if (col === "black") return true;
    if (col === activeColor) return true;
    if (col === topCol && topCol !== "black") return true;
    if (typ === topType) return true;
    return false;
}

/**
 * Draw exactly 1 card. Tell client if it's playable or not.
 */
function DrawOneCard (socket)
{
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "DrawOneCard");
    if (nServerIndex == -1) return;

    const player = mapValue.players[nServerIndex];
    const card = cardGenerator.GetCardDeck(strRoomCode, h_GetMode(strRoomCode));
    if (!card) {
        // Pile exhausted — can't draw
        socket.emit("g_DrawOneCardResult", false);
        return;
    }

    player.cards.push(card);

    // Send updated hand to player
    let data = { name: player.name, winCount: player.winCount, cards: player.cards };
    io.to(socket.id).emit("g_UpdateSelfCardsCount_NoAutoEnd", data);

    // Send card backs to others
    let backs = player.cards.map(() => "black-back");
    socket.to(strRoomCode).emit("g_UpdateOtherPlayerCards", player.name, backs);

    // Check if drawn card is playable
    const topCard = mapValue.game.lastTopCard || "";
    const activeColor = mapValue.game.activeColor || "";
    const bPlayable = h_IsCardPlayable(card, topCard, activeColor);

    // Tell client: playable → can play or end turn, not playable → draw again
    socket.emit("g_DrawOneCardResult", bPlayable);

    // Check elimination (25+ cards)
    h_CheckElimination(strRoomCode, mapValue, nServerIndex);
}

///////////////////////////////////////////////////////////////////////////
//// No Mercy: Discard All — remove all cards of given color
///////////////////////////////////////////////////////////////////////////
function DiscardAll (socket, strColor)
{
    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "DiscardAll");
    if (nServerIndex == -1) return;

    const player = mapValue.players[nServerIndex];
    const kept = [];
    for (let i = 0; i < player.cards.length; i++) {
        const card = player.cards[i];
        const dashIdx = card.indexOf("-");
        const col = card.slice(0, dashIdx);
        if (col !== strColor) {
            kept.push(card);
        }
    }
    player.cards = kept;

    // Update other players about card count
    let cardsData = [];
    for (let i = 0; i < player.cards.length; i++) cardsData.push("black-back");
    socket.to(strRoomCode).emit("g_UpdateOtherPlayerCards", player.name, cardsData);

    // Check if player won (empty hand)
    if (player.cards.length === 0) {
        console.log("Player won via Discard All: " + player.name);
        h_PlayerWonRound(strRoomCode, mapValue, nServerIndex);
    }
}

///////////////////////////////////////////////////////////////////////////
//// No Mercy: Color Roulette — draw from pile until color match
///////////////////////////////////////////////////////////////////////////
function ColorRoulette (socket, strChosenColor)
{
    if (!strChosenColor || !["red", "blue", "green", "yellow"].includes(strChosenColor)) return;

    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "ColorRoulette");
    if (nServerIndex == -1) return;

    const player = mapValue.players[nServerIndex];
    let drawnCount = 0;
    const maxDraw = 168;

    for (let i = 0; i < maxDraw; i++) {
        const card = cardGenerator.GetCardDeck(strRoomCode, h_GetMode(strRoomCode));
        if (!card) break;
        player.cards.push(card);
        drawnCount++;

        // Check if this card matches the chosen color (wild/black doesn't count)
        const dashIdx = card.indexOf("-");
        const col = card.slice(0, dashIdx);
        if (col === strChosenColor) break;
    }

    // Send updated hand to the player (NoAutoEnd — server handles turn advance)
    let data = new Object();
    data.name = player.name;
    data.winCount = player.winCount;
    data.cards = player.cards;
    io.to(socket.id).emit("g_UpdateSelfCardsCount_NoAutoEnd", data);

    // Update other players about card count
    let cardsData = [];
    for (let i = 0; i < player.cards.length; i++) cardsData.push("black-back");
    socket.to(strRoomCode).emit("g_UpdateOtherPlayerCards", player.name, cardsData);

    // Notify all how many cards were drawn
    io.in(strRoomCode).emit("g_ColorRouletteResult", player.name, drawnCount, strChosenColor);

    // Check elimination (25+ cards)
    h_CheckElimination(strRoomCode, mapValue, nServerIndex);

    // Advance to next player (roulette victim's turn is consumed)
    if (!player.eliminated) {
        const nNextIndex = h_CalculateNextPlayerTurn(mapValue, "", "colorroulette", 0, null);
        mapValue.game.nTurnIndex = nNextIndex;
        io.in(strRoomCode).emit("g_StartTurn", mapValue.players[nNextIndex].name, {nForceDraw: 0, nForceDrawValue: 0, strAdditionalCol: "", bSkipAll: false, bCanChallenge: false});
    }
}

///////////////////////////////////////////////////////////////////////////
//// No Mercy: Elimination at 25+ cards
///////////////////////////////////////////////////////////////////////////
function h_CheckElimination (strRoomCode, mapValue, nPlayerIndex)
{
    // No Mercy only — classic mode has no elimination
    if (mapValue.game && mapValue.game.mode === "classic") return false;

    const player = mapValue.players[nPlayerIndex];
    if (!player || player.cards.length < 25) return false;

    console.log("ELIMINATED: " + player.name + " (" + player.cards.length + " cards)");
    player.cards = [];
    player.eliminated = true;

    io.in(strRoomCode).emit("g_PlayerEliminated", player.name);

    // Check last standing
    let aliveCount = 0;
    let lastAlive = null;
    for (let i = 0; i < mapValue.count; i++) {
        if (!mapValue.players[i].eliminated) {
            aliveCount++;
            lastAlive = i;
        }
    }
    if (aliveCount === 1 && lastAlive !== null) {
        console.log("Last standing winner: " + mapValue.players[lastAlive].name);
        h_PlayerWonRound(strRoomCode, mapValue, lastAlive);
        return true;
    }

    // If eliminated player was the current turn player, advance to next alive player
    if (mapValue.game.nTurnIndex === nPlayerIndex && aliveCount > 1) {
        const nNext = h_CalculateNextPlayerTurn(mapValue, "", "", 0, null);
        if (nNext !== undefined && nNext !== nPlayerIndex) {
            mapValue.game.nTurnIndex = nNext;
            io.in(strRoomCode).emit("g_StartTurn", mapValue.players[nNext].name, {nForceDraw: 0, nForceDrawValue: 0, strAdditionalCol: "", bSkipAll: false, bCanChallenge: false});
        }
    }
    return true;
}

function SendChatMessage (socket, strMessage)
{
    if (!strMessage || typeof strMessage !== "string") return;

    // Sanitize: trim, limit length, strip control characters
    const cleaned = strMessage.trim().slice(0, 200).replace(/[\x00-\x1F]/g, "");
    if (cleaned.length === 0) return;

    const {roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex} = GetGenericValuesFromSocket (socket.id, "SendChatMessage");
    if (nServerIndex == -1) { return; }

    const playerName = mapValue.players[nServerIndex].name;
    console.log("Chat [" + strRoomCode + "] " + playerName + ": " + cleaned);
    io.in(strRoomCode).emit("g_ReceiveChatMessage", playerName, cleaned);
}

function GetGenericValuesFromSocket (socketId, strFunctionName)
{
    const strRoomCode = mapSocketIdToRoomCode.get (socketId);
    if (!strRoomCode) { 
        Log (LogWarn, "Socketid dne func:" + strFunctionName);
        return { roomCode: undefined, mapValue: undefined, index: -1 }; 
    }

    const mapValue = mapRoomCodeToPlayers.get (strRoomCode);
    if (!mapValue) { 
        Log (LogWarn, "MapValue dne func:" + strFunctionName); 
        return { roomCode: strRoomCode, mapValue: undefined, index: -1 }; 
    }
    
    let nServerIndex = -1;
    for (let i = 0; i < mapValue.count; i++)
    {
        if (socketId === mapValue.players[i].socketId)
        {
            nServerIndex = i;
            break;
        }
    }
    if (nServerIndex == -1) { 
        Log (LogWarn, "ServerId dne func: " + strFunctionName); 
    }
    return { roomCode: strRoomCode, mapValue: mapValue, index: nServerIndex };  
} 