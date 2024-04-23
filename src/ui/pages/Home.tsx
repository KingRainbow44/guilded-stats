import API from "@backend/api.ts";

function Home() {
    return (
        <div
            data-tauri-drag-region={true}
            className={"Home w-screen h-screen bg-blue-500 flex"}
        >
            <button
                className={"bg-blue-200 p-2 w-fit h-fit"}
                onClick={async () => {
                    const gameData = await API.getCurrentGame();
                    console.log(gameData);
                }}
            >
                resolve game data
            </button>

            <button
                className={"bg-blue-200 p-2 w-fit h-fit"}
                onClick={async () => {
                    console.log(API.socket);
                }}
            >
                websocket conn?
            </button>
        </div>
    );
}

export default Home;
