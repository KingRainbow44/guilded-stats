import { Route, Routes } from "react-router-dom";

import Home from "@pages/Home.tsx";
import Tracker from "@pages/Tracker.tsx";

import "@css/App.scss";

function App() {
    return (
        <div className={"App"}>
            <Routes>
                <Route path={"/"} element={<Home />} />
                <Route path={"/tracker"} element={<Tracker />} />
            </Routes>
        </div>
    );
}

export default App;
