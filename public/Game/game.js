const ug_nGenericTimeout = 15000;    //ms — enough for 8 players connecting simultaneously
//Timeout booleans
let ug_bInitJoinRoom = false;
let ug_bInitJoinRoomAlreadyFailed = false;

//////////////////////////////////////////////////////////////////////////////////////////
///////////          Sound Effects
//////////////////////////////////////////////////////////////////////////////////////////
const ug_sfx = {
    fah: new Audio("Game/Sounds/fah.mp3"),
    kasongo: new Audio("Game/Sounds/kasongo.mp3"),
    atassa: new Audio("Game/Sounds/atassa.mp3"),
};
ug_sfx.fah.preload = "auto";
ug_sfx.fah.volume = 0.7;
ug_sfx.kasongo.preload = "auto";
ug_sfx.kasongo.volume = 0.8;
ug_sfx.atassa.preload = "auto";
ug_sfx.atassa.volume = 0.8;

// Mobile audio unlock: browsers block audio until first user interaction
let ug_bAudioUnlocked = false;
function UGi_UnlockAudio() {
    if (ug_bAudioUnlocked) return;
    ug_bAudioUnlocked = true;
    // Create and play a silent buffer to unlock audio context
    for (const key in ug_sfx) {
        const snd = ug_sfx[key];
        snd.play().then(() => { snd.pause(); snd.currentTime = 0; }).catch(() => {});
    }
    document.removeEventListener("touchstart", UGi_UnlockAudio);
    document.removeEventListener("click", UGi_UnlockAudio);
}
document.addEventListener("touchstart", UGi_UnlockAudio, { once: true });
document.addEventListener("click", UGi_UnlockAudio, { once: true });

/** Play "FAHHH" for 2 sec — on +10 */
function UGi_PlayFahSound() {
    const snd = ug_sfx.fah;
    snd.currentTime = 0;
    snd.play().catch(() => {});
    setTimeout(() => { snd.pause(); snd.currentTime = 0; }, 2000);
}

/** Play "KASONGO" for 16 sec — on stack >= 6 */
function UGi_PlayKasongoSound() {
    const snd = ug_sfx.kasongo;
    snd.currentTime = 0;
    snd.play().catch(() => {});
    setTimeout(() => { snd.pause(); snd.currentTime = 0; }, 16000);
}

/** Play "ATASSA" from 3 sec to end — on +4 attack */
function UGi_PlayAtassaSound() {
    const snd = ug_sfx.atassa;
    snd.currentTime = 3; // Start at 3 seconds
    snd.play().catch(() => {});
}

//////////////////////////////////////////////////////////////////////////////////////////
///////////          Confetti Explosion (winner celebration)
//////////////////////////////////////////////////////////////////////////////////////////

function UGi_LaunchConfetti() {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;pointer-events:none;";
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    const colors = ["#EF4343", "#0066FF", "#00CC5E", "#FFF50F", "#FF8C00", "#FF69B4", "#FFD700"];
    const totalPieces = 100;
    const pieces = [];

    for (let i = 0; i < totalPieces; i++) {
        pieces.push({
            x: Math.random() * canvas.width,
            y: -10 - Math.random() * canvas.height * 0.5,
            w: 6 + Math.random() * 8,
            h: (6 + Math.random() * 8) * 0.6,
            color: colors[Math.floor(Math.random() * colors.length)],
            vy: 2 + Math.random() * 3,
            vx: Math.random() * 2 - 1,
            rot: Math.random() * 360,
            rotSpeed: Math.random() * 6 - 3,
            delay: Math.random() * 60 // frames
        });
    }

    let frame = 0;
    let animId;
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let active = false;
        for (const p of pieces) {
            if (frame < p.delay) { active = true; continue; }
            p.y += p.vy;
            p.x += p.vx;
            p.rot += p.rotSpeed;
            if (p.y > canvas.height + 20) continue;
            active = true;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot * Math.PI / 180);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        }
        frame++;
        if (active) {
            animId = requestAnimationFrame(draw);
        } else {
            canvas.parentNode.removeChild(canvas);
        }
    }
    animId = requestAnimationFrame(draw);

    // Safety cleanup after 6 seconds
    setTimeout(() => {
        cancelAnimationFrame(animId);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }, 6000);
}

// Connection state
let ug_bPlayerDisconnected = false;
let ug_nReconnectAttempts = 0;
const ug_nMaxReconnectAttempts = 5;

// Connection status UI
function UGi_UpdateConnectionUI(status) {
    const el = document.getElementById("connectionStatus");
    const overlay = document.getElementById("reconnectOverlay");
    if (!el) return;

    el.classList.remove("disconnected", "reconnecting");
    if (status === "connected") {
        el.classList.remove("disconnected", "reconnecting");
        el.querySelector(".connectionText").textContent = "Connecte";
        if (overlay) overlay.style.display = "none";
    } else if (status === "disconnected") {
        el.classList.add("disconnected");
        el.querySelector(".connectionText").textContent = "Deconnecte";
        if (overlay) overlay.style.display = "flex";
    } else if (status === "reconnecting") {
        el.classList.add("reconnecting");
        el.querySelector(".connectionText").textContent = "Reconnexion...";
        if (overlay) overlay.style.display = "flex";
    }
}

let ug_strCurrentCardColor;
let ug_strCurrentCardType;

//Note: If you change the name then you would have to change it in server file as well
//nForceDraw gets set to 1 when its a draw2 and gets set to 2 when its a draw4... The value will be the number of cards to pick up which allows people to chain draw2 together
//strAdditionalCol gets set to the color chosen when a wild or draw 4 is thrown
const ug_currCardMeta = {nCardThrown: false, nForceDraw: 0, nForceDrawValue: 0, strAdditionalCol: "", bSkipAll: false};

// Game mode: "nomercy" or "classic"
const ug_strGameMode = GetUrlValue("mode") || "nomercy";
const ug_bNoMercy = (ug_strGameMode !== "classic");

//this can be used to check when its your turn.. This is the master flag.. If this is false then you cannot do anything (master flag)
let ug_bIsYourTurn = false; 
let ug_bCanDrawCard = false;
let ug_bCanThrowAnyCard = false;
let ug_bCanThrowSameNumber = false;
let ug_bForcedDrawPending = false;  // True after clicking deck on a forced draw — turn must auto-end

let ug_strPlayerHasWon = "";
let ug_strCacheId = "";
let ug_bConnected = false;

const nRoundsToWin = 4;
const nMaxPlayers = 8;

// Cached DOM references — avoid repeated querySelector calls
const ug_elYourTurnText = document.querySelector(".player0 h1");
const ug_elChallengeBtn = document.querySelector(".challengeBtn");
const ug_elAcceptDrawBtn = document.querySelector(".acceptDrawBtn");
const ug_elEndTurnBtn = document.querySelector(".endTurnBtn");
const ug_elForceCardCount = document.querySelector(".forceCardCount");
const ug_elWildChooseColor = document.querySelector(".wildChooseColor");
const ug_elWildColorChosen = document.querySelector(".wildColorChoosen");
const ug_elErrorDlg = document.querySelector(".errorDlg");
const ug_elScoreDlg = document.querySelector(".scoreDlg");
const ug_elTurnTimer = document.querySelector(".turnTimer");
const ug_elChatPanel = document.querySelector(".chatPanel");
const ug_elChatBadge = document.querySelector(".chatBadge");
const ug_elChatInput = document.querySelector(".chatInput");
const ug_elChatMessages = document.querySelector(".chatMessages");
const ug_elEmojiList = document.querySelector(".emojiList");


//Sometimes after redirecting, the socket does not connect for some reason... This is a hack... When that happens, forcefully refresh the page so that it connects
setTimeout(() => {
    if (!ug_bConnected)
    {
        window.location.reload(false);
    }
}, 1500);
socket.on("connect", () => {
    ug_bConnected = true;
    ug_nReconnectAttempts = 0;
    UGi_UpdateConnectionUI("connected");

    if (!ug_bPlayerDisconnected)
    {
        ug_bInitJoinRoom = false;

        const strCode = GetUrlValue("id");
        const strMode = GetUrlValue("mode") || "nomercy";
        socket.emit("g_InitJoinRoom", strCode, strMode);

        setTimeout (UGi_InitJoinRoomFailed, ug_nGenericTimeout, "Server did not respond in time");

        // Keep the socket open - with proper cleanup (5s is enough)
        if (window._keepAliveInterval) clearInterval(window._keepAliveInterval);
        window._keepAliveInterval = setInterval (() => {
            if (ug_bPlayerDisconnected) {
                clearInterval(window._keepAliveInterval);
                window._keepAliveInterval = null;
                return;
            }
            socket.emit ("_NonExistantMessage_");
        }, 5000);
    }
});

socket.on("disconnect", () => {
    UGi_UpdateConnectionUI("disconnected");

    // Try to auto-reconnect a few times before giving up
    if (ug_nReconnectAttempts < ug_nMaxReconnectAttempts) {
        ug_nReconnectAttempts++;
        UGi_UpdateConnectionUI("reconnecting");
        // socket.io auto-reconnects by default, we just show UI
    } else {
        ug_bPlayerDisconnected = true;
        UGi_DisplayError("Connexion perdue. Veuillez rafraichir la page.");
    }
});

socket.on("reconnect_failed", () => {
    ug_bPlayerDisconnected = true;
    UGi_UpdateConnectionUI("disconnected");
    UGi_DisplayError("Impossible de se reconnecter. Veuillez rafraichir la page.");
});

socket.on ("g_InitJoinRoomSuccess", () => {
    ug_bInitJoinRoom = true;

    //Show the scoreBoard
    if (!ug_elScoreDlg) { return; }
    ug_elScoreDlg.style.display = "flex";
});

socket.on ("g_InitJoinRoomFailure", (strMessage) => {
    UGi_InitJoinRoomFailed (strMessage);
});

//Note: This function will definately be called once by the setTimeout... It could potentially be called twice if it receives a message from the server
function UGi_InitJoinRoomFailed (strMessage) {
    if (!ug_bInitJoinRoom && !ug_bInitJoinRoomAlreadyFailed) {
        //The server did not respond back/ The InitJoinRoom failed
        ug_bInitJoinRoomAlreadyFailed = true;
        // console.log ("Server did not respond in time");
        
        UGi_DisplayError (strMessage);

    }
}

socket.on ("g_DisplayErrorMessage", (strError) => {
    ug_bIsYourTurn = false;   //Not required but just in case
    UGi_DisplayError (strError);
})

///////////////////////////////////////////////////////
///////////              Update players in the room

const ug_LocalClientMapping = [
    [0],
    [0,3],
    [0,1,3],
    [0,1,3,5],
    [0,1,2,3,5],
    [0,1,2,3,5,6],
    [0,1,2,3,4,5,6],
    [0,1,2,3,4,5,6,7],
];

socket.on ("g_UpdatePlayerNum", (strPlayerOrder, nServerIndex, data) => {
    uc_players.forEach(element => {
        element.style.display = "none";
    });
    if (data.count <= 0) { console.log("Error..."); return; }

    let nIndex = strPlayerOrder.indexOf (nServerIndex.toString());
    if (nIndex == -1) { console.log ("Something went wrong"); return; }

    let strStart = strPlayerOrder.slice (0, nIndex);
    let strEnd = strPlayerOrder.slice (nIndex, strPlayerOrder.length);
    
    let strPlayerOrderRearrange = strEnd + strStart;
    
    //-1 because room can never have 0 players.... It will always have atleast 1
    let clientIndex = ug_LocalClientMapping[data.count-1];

    let mapSeen = new Map();
    for (let i = 0; i < data.count; i++)
    {
        mapSeen.set (clientIndex[i], true);
        const curEle = uc_players[clientIndex[i]];
        curEle.style.display = "flex";
        
        let nServerIndex = Number(strPlayerOrderRearrange[i]);
        UC_SetPlayerDetails (curEle, data.players[nServerIndex], nRoundsToWin);
    }

    const nEmptyData = {name: "", winCount: 0};
    nEmptyData.cards = [];
    for (let i = 0; i < nMaxPlayers; i++)
    {
        if (mapSeen.has (i))    continue;

        const curEle = uc_players[i];
        curEle.style.display = "none";
        UC_SetPlayerDetails (curEle, nEmptyData, nRoundsToWin);
    }
});

socket.on ("g_UpdateScoreBoard", (data, strRoomCode) => {
    UGi_SetScoreBoardDetails (data, strRoomCode);
});
socket.on ("g_SetScoreBoardVisibility", (bShow) => {
    UGi_SetScoreBoardVisibility (bShow);
});

socket.on ("g_UpdateScoreBoard_ShowBtn", (strPlayerWonName) => {
    const scoreBoardNextRoundBtn = ug_elScoreDlg ? ug_elScoreDlg.querySelector(".score_nextBtn") : null;
    if (!scoreBoardNextRoundBtn) { return; }

    scoreBoardNextRoundBtn.style.display = "flex";
    ug_strPlayerHasWon = strPlayerWonName;
    if (strPlayerWonName == "")
    {
        scoreBoardNextRoundBtn.querySelector("p").textContent = "Next Round"; 
    }
    else
    {
        scoreBoardNextRoundBtn.querySelector("p").textContent = "Main Menu";
        // WINNER! Launch confetti explosion
        UGi_LaunchConfetti();
    }
});

socket.on ("g_UpdateScoreBoard_HideBtn", () => {
    const scoreBoardNextRoundBtn = ug_elScoreDlg ? ug_elScoreDlg.querySelector(".score_nextBtn") : null;
    if (!scoreBoardNextRoundBtn) { return; }

    scoreBoardNextRoundBtn.style.display = "none";
});

socket.on ("g_StartNextRoundSuccess", (strStartingCard) => {
    UGi_SetScoreBoardVisibility (false);
    UG_UpdateCurrentCard (strStartingCard, null);

    // Reset all player visuals for new round
    UGi_ResetForNewRound();
});

function UGi_ResetForNewRound() {
    // Reset all flags
    ug_bIsYourTurn = false;
    ug_bCanDrawCard = false;
    ug_bCanThrowAnyCard = false;
    ug_bCanThrowSameNumber = false;
    ug_bUnoDeclared = false;
    ug_bForcedDrawPending = false;
    ug_currCardMeta.nCardThrown = 0;
    ug_currCardMeta.nForceDraw = 0;
    ug_currCardMeta.nForceDrawValue = 0;
    ug_currCardMeta.strAdditionalCol = "";
    ug_currCardMeta.bSkipAll = false;
    ug_currCardMeta._prevCardColor = "";

    // Hide all UI overlays
    UG_ShowEndTurnButton(false);
    UGi_WildShowColorPicker(false);
    UGi_WildShowColorChosen("");
    UGi_StopTurnTimer();
    if (ug_elChallengeBtn) ug_elChallengeBtn.style.display = "none";
    if (ug_elAcceptDrawBtn) ug_elAcceptDrawBtn.style.display = "none";
    if (ug_elForceCardCount) ug_elForceCardCount.style.display = "none";
    const swapDlg = document.querySelector(".swapDlg");
    if (swapDlg) swapDlg.style.display = "none";
    if (ug_elYourTurnText) ug_elYourTurnText.style.display = "none";

    // Reset eliminated player visuals (restore opacity/filter)
    for (let i = 0; i < nMaxPlayers; i++) {
        if (uc_players[i]) {
            uc_players[i].style.opacity = "1";
            uc_players[i].style.filter = "none";
        }
    }

    // Reset previous turn highlight
    if (ug_prevTurnPlayer) {
        UC_HighlightPlayerCtn(ug_prevTurnPlayer, false);
        ug_prevTurnPlayer = null;
    }

    // Stop any playing sounds
    for (const key in ug_sfx) {
        ug_sfx[key].pause();
        ug_sfx[key].currentTime = 0;
    }
}

function UGi_SetScoreBoardVisibility (bShow)
{
    if (!ug_elScoreDlg) { return; }
    ug_elScoreDlg.style.display = (bShow ? "flex" : "none");
}
function UGi_GetPlayerFromName (strPlayerName)
{
    for (let i = 0; i < nMaxPlayers; i++)
    {
        const ele = uc_players[i].querySelector("p");
        if (ele.textContent == strPlayerName) {
             return uc_players[i];
        }
    }
    return null;
}

let ug_prevTurnPlayer = null;
socket.on ("g_StartTurn", (strPlayerTurn, metaData) => {

    //Visual stuff
    //Reset the previous players highlight
    if (ug_prevTurnPlayer)
    {
        UC_HighlightPlayerCtn (ug_prevTurnPlayer, false);
    }
    
    const ePlayerTurn = UGi_GetPlayerFromName (strPlayerTurn);
    //Set highlight color for the current player
    UC_HighlightPlayerCtn (ePlayerTurn, true);
    ug_prevTurnPlayer = ePlayerTurn;

    // Reset card-thrown count at the start of every turn so we can distinguish
    // "I played a +2" (attacker, nCardThrown>0) from "I received a +2" (victim, nCardThrown==0)
    ug_currCardMeta.nCardThrown = 0;

    if (metaData)
    {
        ug_currCardMeta.nForceDraw = metaData.nForceDraw;
        ug_currCardMeta.nForceDrawValue = metaData.nForceDrawValue;
        ug_currCardMeta.strAdditionalCol = metaData.strAdditionalCol;
        ug_currCardMeta.bSkipAll = metaData.bSkipAll || false;
    }
    else
    {
        //Reset this back to 0 ??
        ug_currCardMeta.nForceDraw = 0;
        ug_currCardMeta.nForceDrawValue = 0;
        ug_currCardMeta.strAdditionalCol = "";
        ug_currCardMeta.bSkipAll = false;
    }

    UGi_WildShowColorChosen (ug_currCardMeta.strAdditionalCol); //Hide/show the chosen color

    //Set the pick up card count
    {
        if (ug_currCardMeta.nForceDraw == 0)
        {
            ug_elForceCardCount.style.display = "none";
        }
        else
        {
            ug_elForceCardCount.style.display = "flex";
            ug_elForceCardCount.textContent = "+" + ug_currCardMeta.nForceDrawValue.toString();

            // Sound effects based on penalty severity
            if (ug_currCardMeta.nForceDrawValue >= 6)
            {
                UGi_PlayKasongoSound();  // +6, +10 or big stacks
            }
            else if (ug_currCardMeta.nForceDrawValue >= 4)
            {
                UGi_PlayAtassaSound();   // +4 attack
            }
        }
    }

    const yourTurnTextEle = ug_elYourTurnText;
    // No Mercy: Hide UNO button and challenge buttons at start of each turn
    {
        // UNO button stays visible — just reset flag
        ug_bUnoDeclared = false;
    }

    if (ePlayerTurn === uc_playerSelf)
    {
        //Its your turn
        ug_bIsYourTurn = true;
        ug_bCanDrawCard = true;

        // Show UNO button early if you have 2 cards (you need to press before playing)
        UGi_CheckShowUnoButton();

        // Forced draw (+2/+4 stack) — both modes allow stacking with >= value
        if (metaData && metaData.nForceDraw > 0) {
            // Player can stack a draw card with value >= current, or click deck to draw all
            ug_bCanThrowAnyCard = true;
            ug_bCanThrowSameNumber = false;
        } else {
            ug_bCanThrowAnyCard = true;
            ug_bCanThrowSameNumber = true;
        }

        yourTurnTextEle.style.display = "flex";

        // Start turn timer
        UGi_StartTurnTimer();

        // No Mercy: If a +4 was played against us, show challenge/accept buttons
        if (metaData && metaData.bCanChallenge)
        {
            ug_elChallengeBtn.style.display = "flex";
            ug_elAcceptDrawBtn.style.display = "flex";
        }
        else
        {
            ug_elChallengeBtn.style.display = "none";
            ug_elAcceptDrawBtn.style.display = "none";
        }
    }
    else
    {
        //Its not your turn
        ug_bIsYourTurn = false;
        yourTurnTextEle.style.display = "none";
        ug_elChallengeBtn.style.display = "none";
        ug_elAcceptDrawBtn.style.display = "none";
        UGi_StopTurnTimer();
    }
    
});

socket.on ("g_UpdateSelfCardsCount", (data) => {
    UC_SetPlayerDetails (uc_playerSelf, data, nRoundsToWin);

    // After a forced draw (penalty from +2/+4 stack), the turn MUST end immediately.
    // The player drew cards as penalty — they cannot play from those drawn cards.
    if (ug_bForcedDrawPending)
    {
        ug_bForcedDrawPending = false;
        ug_currCardMeta.nCardThrown = 0;
        UGi_EndTurn ();
        return;
    }

    //If player has a valid card then show the end turn button
    let bHasValid = false;
    const nTotalLength = data.cards.length
    let nStartIndex;
    if (ug_currCardMeta.nForceDraw == 0)
    {
        nStartIndex = nTotalLength - 1;
    }
    else
    {
        nStartIndex = nTotalLength - ug_currCardMeta.nForceDrawValue;
    }
    // console.log (nStartIndex);
    for (; nStartIndex < nTotalLength; nStartIndex++)
    {
        const strCard = data.cards[nStartIndex];
        let cardObj = UC_ParseCard (strCard);
        if (!cardObj) { continue; }

        if (UGi_ThrowCardIsValid(cardObj.color, cardObj.type, ug_strCurrentCardColor, ug_strCurrentCardType))
        {
            bHasValid = true;
            break;
        }
    }
    // console.log ("IsValid: " + bHasValid);
    if (bHasValid)
    {
        ug_bIsYourTurn = true;   //This should already be true and should continue being true so no need to set it
        ug_bCanDrawCard = false;
        ug_bCanThrowAnyCard = true;
        ug_bCanThrowSameNumber = true;

        UG_ShowEndTurnButton (true);
    }
    else
    {
        //Players turn is about to end... When we call UGi_EndTurn, the boolean turn flag will get set to false
        ug_currCardMeta.nCardThrown = 0;
        UGi_EndTurn ();
    }

});

socket.on ("g_UpdateThrownCard", (strCurrentCard, cardMeta) => {
    console.log ("Update thrown card");
    if (cardMeta.nCardThrown !== 0)
    {
        UG_UpdateCurrentCard (strCurrentCard, cardMeta);
    }
    else
    {
        console.log ("Error... Card thrown signal was received but meta data is incorrect");
        cardMeta.nCardThrown = 1;
        UG_UpdateCurrentCard (strCurrentCard, cardMeta);
    }

    // Sound effect: FAHHH when +10 is played
    if (strCurrentCard && strCurrentCard.indexOf("draw10") !== -1) {
        UGi_PlayFahSound();
    }
});

socket.on ("g_UpdateOtherPlayerCards", (strPlayerName, cardsData) => {
    let ePlayer = UGi_GetPlayerFromName (strPlayerName);
    if (ePlayer == null) { return; }

    // CRITICAL: Never overwrite our own cards with backs!
    if (ePlayer === uc_playerSelf) {
        console.log("Blocked: server tried to send backs for own cards");
        return;
    }

    UC_SetPlayerCards (ePlayer, cardsData);

    // Track last player who played (for reference)
    if (cardsData.length === 1) {
        ug_strLastPlayerWhoPlayed = strPlayerName;
    }
});

socket.on ("g_SetPlayDirection", (bClockwise) => {
    UC_SetDirection (bClockwise);
});

socket.on ("g_PlayerTryingToJoinActiveGame", (strPlayerName, strCacheId) => {
    console.log (`Player ${strPlayerName} is trying to join: CacheId: ${strCacheId}`);
    const nPlayerJoinDlgHideTimeout = 30;

    ug_strCacheId = strCacheId;

    setTimeout (() => {
        //Send a player cannot join message if one hasnt already been sent
        if (ug_strCacheId)
        {
            ShowPlayerJoinDlg ("", 0);  //Hide the dlg
            socket.emit ("g_AskPlayerJoinResponse", false, ug_strCacheId);
            ug_strCacheId = "";
        }
    }, nPlayerJoinDlgHideTimeout * 1000);
    ShowPlayerJoinDlg (strPlayerName, nPlayerJoinDlgHideTimeout);
});

//Player can join
document.querySelector (".allowDlg_BtnAllow").addEventListener ("click", () => {
    if (ug_strCacheId)
    {
        ShowPlayerJoinDlg ("", 0);  //Hide the dlg
        socket.emit ("g_AskPlayerJoinResponse", true, ug_strCacheId);
        ug_strCacheId = "";
    } 
});

//Player can't join
document.querySelector (".allowDlg_BtnDeny").addEventListener ("click", () => {
    if (ug_strCacheId)
    {
        ShowPlayerJoinDlg ("", 0);  //Hide the dlg
        socket.emit ("g_AskPlayerJoinResponse", false, ug_strCacheId);
        ug_strCacheId = "";
    }
});

//If player name is null then it hides the dlg... Timeout is optional to hide the dialog after a timeout
function ShowPlayerJoinDlg (strPlayerName, nHideTimeoutSec)
{
    const ele = document.querySelector (".allowDlg");
    if (!ele) { console.log("Error..."); return; }

    if (!strPlayerName)
    {
        ele.style.display = "none";
    }
    else
    {
        ele.style.display = "flex";
        const elePlayerName = ele.querySelector (".allowDlg_playerName");
        if (!elePlayerName) { console.log("Error..."); return; }
        elePlayerName.textContent = strPlayerName;

        //Hide the dlg after a timeout... Optional
        if (nHideTimeoutSec >= 0)
        {
            setTimeout (() => {
                ele.style.display = "none";
            }, nHideTimeoutSec * 1000);
        }
    }
}

////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////

function UGi_DrawCard (nCardsToDraw)
{
    if (!nCardsToDraw || nCardsToDraw <= 0) { return; }
    socket.emit ("g_DrawCardsSelf", nCardsToDraw);
}

//Some player drew a card
socket.on ("g_RotateClosedDeck", () => {
    console.log ("Rishi control1");
    AC_StartDeckAnim ();
})

//Draw a card
document.querySelector (".deckCard").addEventListener ("click", () => {
    if (ug_bPlayerDisconnected) { return; }
    if (!ug_bCanDrawCard) { return; }

    // Immediately lock to prevent double-click
    ug_bCanDrawCard = false;

    if (ug_currCardMeta.nForceDraw != 0)
    {
        // Forced draw (stack penalty) — draw all at once, turn auto-ends after
        if (ug_currCardMeta.nForceDrawValue == 0) { ug_currCardMeta.nForceDrawValue = 1; }
        ug_bForcedDrawPending = true;
        UGi_DrawCard (ug_currCardMeta.nForceDrawValue);
    }
    else
    {
        // Normal draw: 1 card at a time. Server tells us if it's playable.
        socket.emit("g_DrawOneCard");
    }
    AC_StartDeckAnim ();
    socket.emit ("g_RotateClosedDeckAllPlayers");
    ug_currCardMeta.nCardThrown = 0;
});

// Server response after drawing 1 card
socket.on("g_DrawOneCardResult", (bPlayable) => {
    if (bPlayable) {
        // Drawn card is playable — player can play it or end turn
        ug_bCanThrowAnyCard = true;
        ug_bCanThrowSameNumber = false; // After drawing, can only play matching cards (not same-number shortcut)
        UG_ShowEndTurnButton(true);
    } else {
        if (ug_bNoMercy) {
            // No Mercy: keep drawing until you find a playable card
            ug_bCanDrawCard = true;
        } else {
            // CLASSIC: drawn card not playable → turn ends immediately (PDF rule)
            ug_currCardMeta.nCardThrown = 0;
            UGi_EndTurn();
        }
    }
});

//////////
// data:
//      players :
//          string name
//          int? winCount
//          array cards
//      int count

function UGi_SetScoreBoardDetails (data, strRoomCode) {
    const scoreBoardDlg = document.querySelector (".scoreDlg");
    if (!scoreBoardDlg || !data) { console.log ("Error..."); return; }

    const scoreBoardDlg_RoomCode = scoreBoardDlg.querySelector (".scoreDlg_HeaderRight p");
    scoreBoardDlg_RoomCode.textContent = strRoomCode;
    
    for (let i = 0; i < data.count; i++)
    {
        const curPlayer = data.players[i];
        if (!curPlayer) { console.log ("Error..."); continue; }

        const element = scoreBoardDlg.querySelector (".score_player" + i.toString());
        if (!element) { console.log ("Error..."); continue; }

        element.style.display = "flex";
        const pchildren = element.querySelectorAll ("p");
        //name
        pchildren[0].textContent = curPlayer.name;
        //wins
        pchildren[1].textContent = curPlayer.winCount.toString() + " / " + nRoundsToWin.toString();
    }

    for (let i = data.count; i < nMaxPlayers; i++)
    {
        const element = scoreBoardDlg.querySelector (".score_player" + i.toString());
        if (!element) { console.log ("Error..."); continue; }
        element.style.display = "none";
    }
}


//////////////////////////////////////////////////////////////////////////////////////////v
//////////

document.querySelectorAll (".wildChooseColor .block").forEach ((block) => {
    block.addEventListener ("click", () => {
        // If color roulette is active, handle that instead of wild card
        if (typeof ug_bRouletteActive !== "undefined" && ug_bRouletteActive) {
            const strColor = block.getAttribute("blockCol");
            ug_bRouletteActive = false;
            UGi_WildShowColorPicker(false);
            socket.emit("g_ColorRoulette", strColor);
            return;
        }

        ug_currCardMeta.strAdditionalCol = block.getAttribute ("blockCol");
        console.log (ug_currCardMeta.strAdditionalCol);
        UGi_WildShowColorPicker (false);

        const strCard = ug_strCurrentCardColor + "-" + ug_strCurrentCardType;
        socket.emit ("g_UpdateThrownCardAllPlayers", strCard, ug_currCardMeta);

        UGi_EndTurn();
    });
});

//Wild/Draw4 Color Picker
function UGi_WildShowColorPicker (bShow) {
    if (!ug_elWildChooseColor) { return; }
    ug_elWildChooseColor.style.display = (bShow === true ? "flex" : "none");

    // Update label based on context
    const label = ug_elWildChooseColor.querySelector(".colorPickerLabel");
    if (label) {
        if (typeof ug_bRouletteActive !== "undefined" && ug_bRouletteActive) {
            label.textContent = "Roulette — Pick a color";
        } else {
            label.textContent = "Choose Color";
        }
    }
}

//Wild/Draw4 show color chosen
function UGi_WildShowColorChosen (strCol)
{
    const ele = ug_elWildColorChosen;
    if (!ele) { return; }

    if (strCol === "")
    {
        ele.style.display = "none";
        return;
    }
    else
    {
        ele.style.display = "flex";
        if (strCol == "red")
        {
            ele.style.background = "#EF5555"
        }
        else if (strCol == "blue")
        {
            ele.style.background = "#0066FF"
        }
        else if (strCol == "green")
        {
            ele.style.background = "#00CC5E"
        }
        else if (strCol == "yellow")
        {
            ele.style.background = "#FFF50F"
        }
        else
        {
            console.log ("Error...");
            return;
        }
    }
}

////////////////////////////////////////////////////////////

//If strMessage is "" then the dialog is hidden
function UGi_DisplayError (strMessage)
{
    const errorDlg = ug_elErrorDlg;
    if (!errorDlg) { return; }

    if (strMessage == "")
    {
        errorDlg.style.display = "none";
        return;
    }
    
    errorDlg.style.display = "flex";
    const eMessage = errorDlg.querySelector(".errorDlg_msg");
    if (!eMessage) { console.log ("Error..."); return; }

    eMessage.textContent = strMessage;
}

//////////////////////////////////////////////////

function UG_UpdateCurrentCard (strCurrCard, cardMeta) {
    AC_SetCurrentCardAnim (strCurrCard);
    let cardObj = UC_ParseCard (strCurrCard);
    if (cardObj)
    {
        ug_strCurrentCardColor = cardObj.color;
        ug_strCurrentCardType = cardObj.type;
    }
    else
    {
        console.log ("Error...");
    }
}

//Clicked end turn button
document.querySelector(".endTurnBtn").addEventListener ("click", () => {
    console.log ("Ending turn");
    // UG_ShowEndTurnButton (false); //This gets called by UGi_EndTurn
    UGi_EndTurn ();
});

function UG_ShowEndTurnButton (bShow) {
    const ele = ug_elEndTurnBtn;
    if (!ele) { return; }
    
    if (bShow === true)
    {
        ele.style.display = "flex";
    }
    else
    {
        ele.style.display = "none";
    }
}

//public
//function gets called when the player clicks on their OWN card
function UG_CardOnClick(eCard) {
    if (ug_bPlayerDisconnected) { console.log("Player disconnected... Cannot click on card"); return; }
    
    if (!ug_bIsYourTurn) { return; } //Not your turn
    if (!(ug_bCanThrowAnyCard || ug_bCanThrowSameNumber)) { return; } //Player cannot throw a card

    const strColor = eCard.getAttribute ("cardColor");
    const strType = eCard.getAttribute ("cardType");
    if (!strColor || !strType) { console.log ("Error..."); return; }

    if (!UGi_ThrowCardIsValid(strColor, strType, ug_strCurrentCardColor, ug_strCurrentCardType)) { return; } 
    
    //valid card was clicked
    // Store previous color BEFORE updating (needed for draw4 challenge)
    ug_currCardMeta._prevCardColor = ug_strCurrentCardColor;

    ug_strCurrentCardColor = strColor;
    ug_strCurrentCardType = strType;

    //Set meta data
    ug_currCardMeta.nCardThrown += 1;

    // Penalty card values (No Mercy official stacking: >= last value)
    if (strType === "draw2") {
        ug_currCardMeta.nForceDraw = 2;
        ug_currCardMeta.nForceDrawValue += 2;
    } else if (strType === "draw4" || strType === "reversedraw4") {
        ug_currCardMeta.nForceDraw = 4;
        ug_currCardMeta.nForceDrawValue += 4;
    } else if (strType === "draw6") {
        ug_currCardMeta.nForceDraw = 6;
        ug_currCardMeta.nForceDrawValue += 6;
    } else if (strType === "draw10") {
        ug_currCardMeta.nForceDraw = 10;
        ug_currCardMeta.nForceDrawValue += 10;
    } else {
        ug_currCardMeta.nForceDraw = 0;
        ug_currCardMeta.nForceDrawValue = 0;
    }

    ug_bCanThrowAnyCard = false;
    ug_bCanDrawCard = false;

    // Wild/black cards → need color picker
    if (strColor === "black")
    {
        UG_ShowEndTurnButton (false);
        UGi_WildShowColorPicker (true);
        UGi_StopTurnTimer(); // Pause timer while choosing color
        ug_bCanThrowSameNumber = false;
    }
    // Colored skipeveryone → you play again (no color picker needed)
    else if (strType === "skipeveryone")
    {
        ug_currCardMeta.bSkipAll = true;
        ug_currCardMeta.strAdditionalCol = "";
        const strCard = ug_strCurrentCardColor + "-" + ug_strCurrentCardType;
        socket.emit ("g_UpdateThrownCardAllPlayers", strCard, ug_currCardMeta);
    }
    else
    {
        ug_currCardMeta.strAdditionalCol = "";
        const strCard = ug_strCurrentCardColor + "-" + ug_strCurrentCardType;
        socket.emit ("g_UpdateThrownCardAllPlayers", strCard, ug_currCardMeta);
    }

    UGi_WildShowColorChosen ("");   //Remove the wild color if its being shown currently
    //This will get set by the animation
    AC_SetCurrentCardAnim (strColor + "-" + strType);
    UC_RemoveCard (eCard);
    socket.emit ("g_RemoveCardFromMyDeck", strColor + "-" + strType);

    // Sound effect: FAHHH when you play a +10
    if (strType === "draw10") {
        UGi_PlayFahSound();
    }

    // No Mercy: Show UNO button if player is about to have 1 card
    UGi_CheckShowUnoButton();



    //if ug_bCanThrowSameNumber is false then I threw a black card and hence my turn will get over as soon as I choose a color... Dont call end_turn as it will be called once I choose a color...
    if (ug_bCanThrowSameNumber)
    {
        if (ug_bNoMercy) {
            // No Mercy: Card 0 - rotate all hands (only on first throw)
            if (strType === "0" && ug_currCardMeta.nCardThrown === 1)
            {
                socket.emit("g_SwapAllHands");
            }

            // No Mercy: Card 7 - swap with chosen player (only on first throw)
            if (strType === "7" && ug_currCardMeta.nCardThrown === 1)
            {
                UGi_ShowSwapPlayerPicker();
                return;
            }

            // No Mercy: Discard All
            if (strType === "discardall")
            {
                UGi_DiscardAllSameColor(strColor);
                UGi_EndTurn();
                return;
            }
        }

        // Both modes: check if player can throw another card of the same type
        let bHasValidNumber = false;
        const cards = UGi_GetSelfCardsFromHtml();
        for (let i = 0; i < cards.length && !bHasValidNumber; i++)
        {
            const curCard = cards[i];
            bHasValidNumber = UGi_ThrowCardIsValid(curCard.strColor, curCard.strType, ug_strCurrentCardColor, ug_strCurrentCardType)
        }

        if (bHasValidNumber)
            UG_ShowEndTurnButton (true);
        else
            UGi_EndTurn ();
    }
    else if (ug_currCardMeta.nForceDraw > 0 && strColor !== "black")
    {
        // Played a COLORED draw card to stack (+2 on +2, etc.) — end turn immediately
        // Wild/black draw cards are excluded: they need the color picker first,
        // and UGi_EndTurn() is called after the player picks a color.
        UGi_EndTurn ();
    }
}

/**
 * Discard All: remove all cards of the given color from own hand.
 */
function UGi_DiscardAllSameColor(strColor) {
    // Remove matching cards from DOM only (server handles hand via g_DiscardAll)
    const cardElements = uc_playerSelf.querySelectorAll(".cardCtnHor img");
    for (let i = cardElements.length - 1; i >= 0; i--) {
        const el = cardElements[i];
        if (el.getAttribute("cardColor") === strColor) {
            UC_RemoveCard(el);
        }
    }
    // Server removes all matching cards in one operation
    socket.emit("g_DiscardAll", strColor);
}

function UGi_GetSelfCardsFromHtml () {
    let cardsArray = [];

    const cardCtnDiv = uc_playerSelf.querySelectorAll (".cardCtnHor img");
    for (let i = 0; i < cardCtnDiv.length; i++)
    {
        const eCard = cardCtnDiv[i];
        const strColor = eCard.getAttribute ("cardColor");
        const strType = eCard.getAttribute ("cardType");
        if (!strColor || !strType) { console.log ("Major Error..."); return []; }
        
        cardsArray[i] = {strColor: strColor, strType: strType};
    }
    return cardsArray;
}

// Classic: check if player has any card of a given color in hand
function UGi_PlayerHasColor (strColor)
{
    if (!strColor || strColor === "black") return false;
    const cardCtnDiv = uc_playerSelf.querySelectorAll(".cardCtnHor img");
    for (let i = 0; i < cardCtnDiv.length; i++)
    {
        const col = cardCtnDiv[i].getAttribute("cardColor");
        if (col === strColor) return true;
    }
    return false;
}

// No Mercy: get the penalty value of a draw card type
function UGi_GetDrawValue (strCardType)
{
    if (strCardType === "draw2") return 2;
    if (strCardType === "draw4" || strCardType === "reversedraw4") return 4;
    if (strCardType === "draw6") return 6;
    if (strCardType === "draw10") return 10;
    return 0;
}

function UGi_IsDrawCard (strCardType)
{
    return UGi_GetDrawValue(strCardType) > 0;
}

function UGi_ThrowCardIsValid (strCardCol, strCardType, strCurrentCol, strCurrentType)
{
    if (ug_bCanThrowAnyCard)
    {
        // Stacking rule: can play a draw card with value >= the current stack
        // Ex: +4 on +2 ✓, +2 on +2 ✓, +2 on +4 ✗
        if (ug_currCardMeta.nForceDraw !== 0)
        {
            const cardDraw = UGi_GetDrawValue(strCardType);
            return cardDraw >= ug_currCardMeta.nForceDraw;
        }

        let bCanThrowCard = false;
        // Same color, same type, wild/black, or chosen wild color match
        if (strCardCol === strCurrentCol ||
            strCardType === strCurrentType ||
            strCardCol === "black" ||
            (ug_currCardMeta.strAdditionalCol !== "" && ug_currCardMeta.strAdditionalCol === strCardCol))
        {
            bCanThrowCard = true;
        }

        // Classic mode: Wild Draw 4 can only be played if player has NO card
        // matching the current color (PDF 42003 rule). In No Mercy, bluffing is
        // allowed and handled by the challenge system instead.
        if (bCanThrowCard && !ug_bNoMercy && strCardType === "draw4" && strCardCol === "black")
        {
            const activeCol = ug_currCardMeta.strAdditionalCol || strCurrentCol;
            if (UGi_PlayerHasColor(activeCol)) {
                bCanThrowCard = false;
            }
        }

        return bCanThrowCard;
    }
    else if (ug_bCanThrowSameNumber)
    {
        return strCardType === strCurrentType || strCardCol === strCurrentCol;
    }
    else
    {
        return false;
    }
}

///////////
//////////////////////////////////////////////////////////////////////////////////////////
///////////          No Mercy: UNO Call System
//////////////////////////////////////////////////////////////////////////////////////////

let ug_bUnoDeclared = false;
let ug_strLastPlayerWhoPlayed = "";

// UNO button is ALWAYS visible — available to everyone from the start
function UGi_CheckShowUnoButton () {
    // Always visible now — no-op, button stays shown
}

// UNO button click — anyone can click at any time
// Server validates: if you don't have 1 card → penalty
document.querySelector(".unoCallBtn").addEventListener("click", () => {
    socket.emit("g_DeclareUno");
    ug_bUnoDeclared = true;
});

// Server tells us someone declared UNO (with result)
socket.on("g_PlayerDeclaredUno", (strPlayerName, bValid) => {
    if (bValid) {
        UGi_ShowUnoNotification(strPlayerName, true);
    } else {
        UGi_ShowUnoNotification(strPlayerName, false);
    }
});

function UGi_ShowUnoNotification(name, bValid) {
    const notif = document.createElement("div");
    const bg = bValid ? "rgba(0,204,94,0.95)" : "rgba(239,67,67,0.95)";
    const txt = bValid ? (name + " : UNO!") : (name + " : faux UNO! +2 penalite!");
    notif.style.cssText =
        "position:fixed;top:12%;left:50%;transform:translateX(-50%);" +
        "background:" + bg + ";color:#fff;padding:12px 28px;" +
        "border-radius:14px;font-size:18px;font-weight:700;z-index:9999;" +
        "font-family:'Montserrat',sans-serif;text-align:center;" +
        "box-shadow:0 8px 30px rgba(0,0,0,0.5);animation:chatSlideDown 0.3s ease-out;";
    notif.textContent = txt;
    document.body.appendChild(notif);
    setTimeout(() => {
        notif.style.transition = "opacity 0.5s"; notif.style.opacity = "0";
        setTimeout(() => { if (notif.parentNode) notif.parentNode.removeChild(notif); }, 500);
    }, 2500);
}

// SPACEBAR = UNO shortcut
document.addEventListener("keydown", (e) => {
    // Don't trigger if typing in chat input
    if (e.target.classList.contains("chatInput")) return;
    if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        socket.emit("g_DeclareUno");
        ug_bUnoDeclared = true;
    }
});

//////////////////////////////////////////////////////////////////////////////////////////
///////////          No Mercy: Challenge +4 System
//////////////////////////////////////////////////////////////////////////////////////////

ug_elChallengeBtn.addEventListener("click", () => {
    socket.emit("g_ChallengeDrawFour");
    ug_elChallengeBtn.style.display = "none";
    ug_elAcceptDrawBtn.style.display = "none";
});

ug_elAcceptDrawBtn.addEventListener("click", () => {
    socket.emit("g_AcceptDraw");
    ug_elChallengeBtn.style.display = "none";
    ug_elAcceptDrawBtn.style.display = "none";
});

socket.on("g_ChallengeResult", (strChallengerName, strAccusedName, bBluffDetected) => {
    if (bBluffDetected) {
        console.log("Challenge successful! " + strAccusedName + " was bluffing! +6 penalty!");
    } else {
        console.log("Challenge failed! " + strChallengerName + " draws 6 cards!");
    }
});

//////////////////////////////////////////////////////////////////////////////////////////
///////////          No Mercy: Card 0 - Swap All Hands
//////////////////////////////////////////////////////////////////////////////////////////

socket.on("g_SwapAllHandsNotify", () => {
    console.log("Card 0 played! Everyone's hands have been rotated!");
    UGi_StopTurnTimer();
});

socket.on("g_UpdateSelfCardsCount_NoAutoEnd", (data) => {
    UC_SetPlayerDetails(uc_playerSelf, data, nRoundsToWin);
    // Only update card display — do NOT show End Turn button here.
    // The g_DrawOneCardResult handler controls what the player can do after drawing.
});

//////////////////////////////////////////////////////////////////////////////////////////
///////////          No Mercy: Card 7 - Swap With Player
//////////////////////////////////////////////////////////////////////////////////////////

socket.on("g_SwapWithPlayerNotify", (strSourceName, strTargetName) => {
    console.log(strSourceName + " swapped hands with " + strTargetName + "!");
    const swapDlg = document.querySelector(".swapDlg");
    if (swapDlg) swapDlg.style.display = "none";
    UGi_StopTurnTimer();
});

function UGi_ShowSwapPlayerPicker ()
{
    UGi_StopTurnTimer(); // Pause timer while choosing swap target
    const swapDlg = document.querySelector(".swapDlg");
    if (!swapDlg) return;

    const playersList = swapDlg.querySelector(".swapDlg_playersList");
    playersList.innerHTML = "";

    for (let i = 0; i < nMaxPlayers; i++) {
        const playerEle = uc_players[i];
        if (!playerEle || playerEle.style.display === "none") continue;
        if (playerEle === uc_playerSelf) continue;

        const playerName = playerEle.querySelector("p").textContent;
        if (!playerName) continue;

        const btn = document.createElement("div");
        btn.className = "swapDlg_playerBtn";
        btn.textContent = playerName;
        btn.addEventListener("click", () => {
            socket.emit("g_SwapWithPlayer", playerName);
            swapDlg.style.display = "none";
            UGi_EndTurn();
        });
        playersList.appendChild(btn);
    }

    // Decline button — skip the swap, just end turn
    const declineBtn = document.createElement("div");
    declineBtn.className = "swapDlg_playerBtn swapDlg_declineBtn";
    declineBtn.textContent = "Decline";
    declineBtn.addEventListener("click", () => {
        swapDlg.style.display = "none";
        UGi_EndTurn();
    });
    playersList.appendChild(declineBtn);

    swapDlg.style.display = "flex";
}

//////////////////////////////////////////////////////////////////////////////////////////
///////////          No Mercy: Color Roulette (victim picks color)
//////////////////////////////////////////////////////////////////////////////////////////

let ug_bRouletteActive = false;

// When a colorroulette is played, the START_TURN will arrive with the roulette flag.
// We reuse the color picker for the victim to choose a color.
socket.on("g_ColorRouletteStart", () => {
    ug_bRouletteActive = true;
    UGi_StopTurnTimer(); // Pause timer while victim picks color
    UGi_WildShowColorPicker(true);
});

// Override color picker clicks to handle roulette
// (already handles wild color choice — add roulette check)
// Roulette listener is now integrated into the main wild color picker above (line 624)

socket.on("g_ColorRouletteResult", (strPlayerName, nDrawnCount, strColor) => {
    console.log(strPlayerName + " drew " + nDrawnCount + " cards for Color Roulette (" + strColor + ")");
});

//////////////////////////////////////////////////////////////////////////////////////////
///////////          No Mercy: Elimination notification
//////////////////////////////////////////////////////////////////////////////////////////

// Special rule notification (e.g. 2-player Reverse+4)
socket.on("g_SpecialRuleNotify", (strMessage) => {
    const notif = document.createElement("div");
    notif.style.cssText =
        "position:fixed;top:8%;left:50%;transform:translateX(-50%);" +
        "background:rgba(160,100,255,0.95);color:#fff;padding:12px 28px;" +
        "border-radius:14px;font-size:16px;font-weight:700;z-index:9999;" +
        "font-family:'Montserrat',sans-serif;text-align:center;" +
        "box-shadow:0 8px 30px rgba(0,0,0,0.5);animation:chatSlideDown 0.3s ease-out;" +
        "max-width:80vw;";
    notif.textContent = strMessage;
    document.body.appendChild(notif);
    setTimeout(() => {
        notif.style.transition = "opacity 0.5s"; notif.style.opacity = "0";
        setTimeout(() => { if (notif.parentNode) notif.parentNode.removeChild(notif); }, 500);
    }, 4000);
});

socket.on("g_PlayerEliminated", (strPlayerName) => {
    console.log("ELIMINATED: " + strPlayerName);
    const ePlayer = UGi_GetPlayerFromName(strPlayerName);
    if (ePlayer) {
        ePlayer.style.opacity = "0.3";
        ePlayer.style.filter = "grayscale(100%)";
    }
});

// Auto UNO penalty notification
socket.on("g_AutoUnoPenalty", (strPlayerName) => {
    console.log(strPlayerName + " forgot to say UNO! +2 penalty!");
    // Show a brief notification on screen
    UGi_ShowAutoUnoNotification(strPlayerName);
});

function UGi_ShowAutoUnoNotification(strPlayerName) {
    const notif = document.createElement("div");
    notif.style.cssText =
        "position:fixed;top:15%;left:50%;transform:translateX(-50%);" +
        "background:rgba(239,67,67,0.95);color:#fff;padding:14px 32px;" +
        "border-radius:14px;font-size:18px;font-weight:700;z-index:9999;" +
        "font-family:'Montserrat',sans-serif;text-align:center;" +
        "box-shadow:0 8px 30px rgba(239,67,67,0.5);" +
        "animation:chatSlideDown 0.3s ease-out;";
    notif.textContent = strPlayerName + " n'a pas dit UNO ! +2 cartes !";
    document.body.appendChild(notif);
    setTimeout(() => {
        notif.style.transition = "opacity 0.5s";
        notif.style.opacity = "0";
        setTimeout(() => { if (notif.parentNode) notif.parentNode.removeChild(notif); }, 500);
    }, 3000);
}

//////////////////////////////////////////////////////////////////////////////////////////
///////////          No Mercy: Turn Timer (30 seconds)
//////////////////////////////////////////////////////////////////////////////////////////

let ug_turnTimer = null;
let ug_turnTimerSeconds = 30;

function UGi_StartTurnTimer() {
    UGi_StopTurnTimer();
    ug_turnTimerSeconds = 30;

    if (ug_elTurnTimer) {
        ug_elTurnTimer.style.display = "flex";
        ug_elTurnTimer.textContent = ug_turnTimerSeconds;
    }

    ug_turnTimer = setInterval(() => {
        ug_turnTimerSeconds--;
        if (ug_elTurnTimer) ug_elTurnTimer.textContent = ug_turnTimerSeconds;

        if (ug_turnTimerSeconds <= 0) {
            UGi_StopTurnTimer();
            // Auto-draw if it's your turn and timer ran out
            if (ug_bIsYourTurn) {
                if (ug_currCardMeta.nForceDraw !== 0 && ug_currCardMeta.nCardThrown === 0) {
                    // VICTIM: received a +2/+4 and didn't stack → must draw penalty
                    ug_bForcedDrawPending = true;
                    UGi_DrawCard(ug_currCardMeta.nForceDrawValue);
                    ug_bCanDrawCard = false;
                } else {
                    // ATTACKER (played a draw card, nCardThrown>0) or normal timeout
                    // Don't draw — just end turn. Penalty passes to next player.
                    ug_bCanDrawCard = false;
                    ug_bCanThrowAnyCard = false;
                    ug_bCanThrowSameNumber = false;
                }
                // Small delay for animations, then end turn
                setTimeout(() => {
                    if (ug_bIsYourTurn) UGi_EndTurn();
                }, 500);
            }
        }
    }, 1000);
}

function UGi_StopTurnTimer() {
    if (ug_turnTimer) {
        clearInterval(ug_turnTimer);
        ug_turnTimer = null;
    }
    if (ug_elTurnTimer) ug_elTurnTimer.style.display = "none";
}


function UGi_EndTurn ()
{
    if (!ug_bIsYourTurn) { console.log ("Minor Error..."); return; }
    ug_bIsYourTurn = false;
    UG_ShowEndTurnButton (false);

    if (ug_currCardMeta.nCardThrown === 0)
    {
        //No card was thrown... Reset some meta data because draw2 or draw4 was not thrown
        ug_currCardMeta.nForceDraw = 0;
        ug_currCardMeta.nForceDrawValue = 0;
        ug_currCardMeta.bSkipAll = false;
    }

    const strCard = ug_strCurrentCardColor + "-" + ug_strCurrentCardType;
    socket.emit ("g_PlayerEndTurn", strCard, ug_currCardMeta);

    ug_currCardMeta.nCardThrown = 0;
    ug_currCardMeta.bSkipAll = false;
}

//////////////////////////////////////////////////////////////////////////////////////////
///////////          Emoji Reaction System
//////////////////////////////////////////////////////////////////////////////////////////

const ug_emojiMap = {
    "laugh": "\u{1F602}",
    "rage": "\u{1F621}",
    "skull": "\u{1F480}",
    "fire": "\u{1F525}",
    "clown": "\u{1F921}",
    "sad": "\u{1F62D}"
};

let ug_bEmojiCooldown = false;

// Toggle emoji picker
document.querySelector(".emojiToggleBtn").addEventListener("click", () => {
    if (ug_elEmojiList.style.display === "none" || ug_elEmojiList.style.display === "") {
        ug_elEmojiList.style.display = "flex";
    } else {
        ug_elEmojiList.style.display = "none";
    }
});

// Send emoji when clicked
document.querySelectorAll(".emojiBtn").forEach(btn => {
    btn.addEventListener("click", () => {
        if (ug_bEmojiCooldown) return;

        const emojiKey = btn.getAttribute("data-emoji");
        socket.emit("g_SendEmoji", emojiKey);

        // Cooldown: prevent spam (2 seconds)
        ug_bEmojiCooldown = true;
        document.querySelectorAll(".emojiBtn").forEach(b => b.classList.add("cooldown"));
        setTimeout(() => {
            ug_bEmojiCooldown = false;
            document.querySelectorAll(".emojiBtn").forEach(b => b.classList.remove("cooldown"));
        }, 2000);

        // Hide picker after sending
        ug_elEmojiList.style.display = "none";
    });
});

// Receive emoji from any player (including self)
socket.on("g_ReceiveEmoji", (strPlayerName, strEmojiKey) => {
    const emojiChar = ug_emojiMap[strEmojiKey];
    if (!emojiChar) return;

    UGi_SpawnFloatingEmoji(emojiChar, strPlayerName);
});

function UGi_SpawnFloatingEmoji (emojiChar, strPlayerName)
{
    const container = document.querySelector(".emojiFloatContainer");
    if (!container) return;

    // Find the player position to spawn emoji near them
    let spawnX = 50;  // default center %
    let spawnY = 40;
    const ePlayer = UGi_GetPlayerFromName(strPlayerName);
    if (ePlayer && ePlayer.offsetParent !== null) {
        const rect = ePlayer.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        if (containerRect.width > 0 && containerRect.height > 0) {
            spawnX = Math.max(5, Math.min(90, ((rect.left + rect.width / 2 - containerRect.left) / containerRect.width) * 100));
            spawnY = Math.max(10, Math.min(75, ((rect.top + rect.height / 2 - containerRect.top) / containerRect.height) * 100));
        }
    }

    // Create floating emoji element
    const emojiEl = document.createElement("div");
    emojiEl.className = "emojiFloat";
    emojiEl.style.left = spawnX + "%";
    emojiEl.style.top = spawnY + "%";

    // Add slight random offset for multiple emojis
    emojiEl.style.marginLeft = (Math.random() * 60 - 30) + "px";

    // Build safely (no innerHTML with user data)
    const emojiText = document.createTextNode(emojiChar);
    emojiEl.appendChild(emojiText);

    const senderSpan = document.createElement("span");
    senderSpan.className = "emojiSender";
    senderSpan.textContent = strPlayerName;
    emojiEl.appendChild(senderSpan);

    container.appendChild(emojiEl);

    // Remove after animation completes
    setTimeout(() => {
        if (emojiEl.parentNode) {
            emojiEl.parentNode.removeChild(emojiEl);
        }
    }, 3000);
}

//////////////////////////////////////////////////////////////////////////////////////////
///////////          Leave Room
//////////////////////////////////////////////////////////////////////////////////////////

document.querySelector(".leaveRoomBtn").addEventListener("click", () => {
    if (confirm("Quitter la room ?")) {
        socket.emit("g_PlayerLeaveRoom");
        window.location = "/index.html";
    }
});

//////////////////////////////////////////////////////////////////////////////////////////
///////////          Rules Hint Panel
//////////////////////////////////////////////////////////////////////////////////////////

document.querySelector(".rulesToggleBtn").addEventListener("click", () => {
    const panel = document.querySelector(".rulesPanel");
    panel.style.display = (panel.style.display === "none") ? "flex" : "none";
});
document.querySelector(".rulesCloseBtn").addEventListener("click", () => {
    document.querySelector(".rulesPanel").style.display = "none";
});

//////////////////////////////////////////////////////////////////////////////////////////
///////////          Chat System
//////////////////////////////////////////////////////////////////////////////////////////

let ug_bChatOpen = false;
let ug_nUnreadCount = 0;
let ug_strMyName = "";

/**
 * Grab our player name from the DOM. Called on every relevant event
 * until the name is captured.
 */
function UGi_CaptureMyName() {
    if (ug_strMyName) return;
    const nameEl = uc_playerSelf ? uc_playerSelf.querySelector("p") : null;
    if (nameEl && nameEl.textContent && nameEl.textContent.trim()) {
        ug_strMyName = nameEl.textContent.trim();
        console.log("Chat: my name = " + ug_strMyName);
    }
}
// Try to capture name periodically until found
const _nameInterval = setInterval(() => {
    UGi_CaptureMyName();
    if (ug_strMyName) clearInterval(_nameInterval);
}, 1000);

// Toggle chat panel
document.querySelector(".chatToggleBtn").addEventListener("click", () => {
    ug_bChatOpen = !ug_bChatOpen;
    ug_elChatPanel.style.display = ug_bChatOpen ? "flex" : "none";

    if (ug_bChatOpen) {
        ug_nUnreadCount = 0;
        ug_elChatBadge.style.display = "none";
        ug_elChatInput.focus();
        ug_elChatMessages.scrollTop = ug_elChatMessages.scrollHeight;
    }
});

// Close chat
document.querySelector(".chatCloseBtn").addEventListener("click", () => {
    ug_bChatOpen = false;
    ug_elChatPanel.style.display = "none";
});

// Send message
function UGi_SendChatMessage() {
    const text = ug_elChatInput.value.trim();
    if (!text) return;

    socket.emit("g_SendChatMessage", text);
    ug_elChatInput.value = "";
    ug_elChatInput.focus();
}

document.querySelector(".chatSendBtn").addEventListener("click", UGi_SendChatMessage);
document.querySelector(".chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        UGi_SendChatMessage();
    }
    // Prevent game key shortcuts while typing in chat
    e.stopPropagation();
});

// Receive chat message
socket.on("g_ReceiveChatMessage", (strPlayerName, strText) => {
    console.log("Chat: received from '" + strPlayerName + "': " + strText);
    UGi_AddChatMessage(strPlayerName, strText);
});

function UGi_AddChatMessage(strPlayerName, strText) {
    if (!ug_elChatMessages) return;

    const isSelf = (strPlayerName === ug_strMyName);

    const msgDiv = document.createElement("div");
    msgDiv.className = "chatMsg " + (isSelf ? "self" : "other");

    const nameSpan = document.createElement("span");
    nameSpan.className = "chatMsgName";
    nameSpan.textContent = strPlayerName;

    const textSpan = document.createElement("span");
    textSpan.className = "chatMsgText";
    textSpan.textContent = strText;

    msgDiv.appendChild(nameSpan);
    msgDiv.appendChild(textSpan);
    ug_elChatMessages.appendChild(msgDiv);

    // Auto-scroll
    ug_elChatMessages.scrollTop = ug_elChatMessages.scrollHeight;

    // Badge if chat is closed
    if (!ug_bChatOpen && !isSelf) {
        ug_nUnreadCount++;
        ug_elChatBadge.textContent = ug_nUnreadCount;
        ug_elChatBadge.style.display = "flex";
    }

    // Limit messages in DOM (keep last 50)
    while (ug_elChatMessages.children.length > 50) {
        ug_elChatMessages.removeChild(ug_elChatMessages.firstChild);
    }
}