const ac_animationCard = document.querySelector(".currentCard");
const ac_deckCard = document.querySelector (".deckCard")
const ac_animDuration = 0.8;  //in seconds 


function AC_SetCurrentCardAnim (strCard)
{
    //Reset animation then restart on next frame (avoids forced reflow)
    ac_animationCard.style.animationName = "none";
    requestAnimationFrame(() => {
        ac_animationCard.style.animationName = "rotateCurrentCard";
        ac_animationCard.style.animationDuration = ac_animDuration.toString() + "s";
    });

    setTimeout (() => {
        UC_SetCurrentCard (strCard);
    }, (ac_animDuration * 1000 / 2));
}

function AC_StartDeckAnim ()
{
    //Reset animation then restart on next frame (avoids forced reflow)
    ac_deckCard.style.animationName = "none";
    requestAnimationFrame(() => {
        ac_deckCard.style.animationName = "rotateCurrentCard";
        ac_deckCard.style.animationDuration = ac_animDuration.toString() + "s";
    });
}