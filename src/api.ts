import type { BunFile } from "bun";
import { WebSocket } from "ws";

/// <editor-fold defaultstate="collapsed" desc="Global Constants">
const clientPlatform = "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9";
/// </editor-fold>

/**
 * Terminology:
 * - a "game" is a match that is currently being played.
 * - a "match" is a game that has been played.
 */
export default class API {
    // Local files.
    private static readonly lockFile: BunFile = Bun.file(
        `${process.env.LOCALAPPDATA}/Riot Games/Riot Client/Config/lockfile`);
    private static readonly logFile: BunFile = Bun.file(
        `${process.env.LOCALAPPDATA}/VALORANT/Saved/Logs/ShooterGame.log`);

    // API information.
    private static apiInfo: APIInfo;
    private static region: string;
    private static shard: string;

    // Cached responses.
    private static chatSession: ChatSessionResponse;
    private static entitlements: EntitlementsTokenResponse;
    private static riotSessions: SessionsResponse;

    // Depended properties.
    private static authToken: string;
    public static playerUuid: string;
    private static clientVersion: string;
    private static entitlementToken: string;

    // WebSocket connection.
    private static socket: WebSocket;

    // <editor-fold defaultstate="collapsed" desc="Setup Methods">

    /**
     * Parses the local lock file and gets the API information.
     */
    public static async parseLockFile(): Promise<boolean> {
        if (!await API.lockFile.exists()) {
            console.log("'lockfile' does not exist. Is VALORANT open?");
            return false;
        }

        const text = await API.lockFile.text();
        const [username, processId, port, password, protocol] = text.split(":");
        API.apiInfo = { username, processId: +processId, port: +port, password, protocol };

        return true;
    }

    /**
     * Parses the local log file and gets the remote API information.
     */
    public static async parseLogFile(): Promise<boolean> {
        if (!await API.logFile.exists()) {
            console.log("'ShooterGame.log' does not exist. Is VALORANT open?");
            return false;
        }

        const text = await API.logFile.text();
        const match = text.match("https://glz-(.+?)-1.(.+?).a.pvp.net");
        if (!match) {
            console.error("Failed to find the region and shard.");
            return false;
        }

        API.region = match[1];
        API.shard = match[2];

        return true;
    }

    /**
     * Connects to the local API socket.
     */
    public static async connectToSocket(): Promise<boolean> {
        if (!API.apiInfo) {
            console.error("API information is not available.");
            return false;
        }

        console.log("Connecting to local websocket...");
        API.socket = new WebSocket(
            `wss://127.0.0.1:${API.apiInfo.port}`,
            { headers: { Authorization: `Basic ${btoa(`riot:${API.apiInfo.password}`)}` } }
        );
        return await new Promise((resolve, _) => {
            API.socket.onopen = () => resolve(true);
            API.socket.onerror = () => resolve(false);
            API.socket.onclose = () => resolve(false);
        });
    }

    /**
     * Calls API methods to cache properties locally.
     */
    public static async setupClient(): Promise<boolean> {
        if (!API.apiInfo && !await API.parseLockFile()) {
            return false;
        }
        if (!API.region && !await API.parseLogFile()) {
            return false;
        }

        API.chatSession = await API.getChatSession();
        API.riotSessions = await API.getSessions();
        API.entitlements = await API.getEntitlementsToken();

        API.authToken = API.entitlements.accessToken;
        API.playerUuid = API.chatSession.puuid;
        API.entitlementToken = API.entitlements.token;

        // Find the VALORANT client.
        const valorantSession = Object
            .values(API.riotSessions)
            .find(session => session.productId == "valorant");
        if (!valorantSession) {
            console.log("VALORANT session not found.");
            return false;
        }
        API.clientVersion = valorantSession.version;

        // Connect to the local API socket.
        if (!await API.connectToSocket()) {
            console.error("Failed to connect to the local API socket.");
            return false;
        }

        console.log("API setup is complete!");
        return true;
    }

    /// </editor-fold>

    /// <editor-fold defaultstate="collapsed" desc="Request Methods">

    /**
     * Performs a local API request.
     *
     * @param path The path to the endpoint.
     * @param requestInfo The request information.
     * @private
     */
    private static async localRequest<T>(path: string, requestInfo?: RequestInfo): Promise<T> {
        const response = await fetch(`${API.apiInfo.protocol}://127.0.0.1:${API.apiInfo.port}/${path}`, {
            headers: { Authorization: `Basic ${btoa(`riot:${API.apiInfo.password}`)}` },
            ...(requestInfo as any)
        });

        if (!response.ok) {
            console.error("Client did not return a good response.",
                response.status, await response.json());
            throw new Error("Failed to fetch data.");
        }

        return await response.json() as T;
    }

    /**
     * Performs a remote API request.
     *
     * @param path The path to the endpoint.
     * @param requestInfo The request information.
     * @param args Additional arguments.
     * @private
     */
    private static async remoteRequest<T>(
        path: string, requestInfo?: RequestInfo,
        args?: {
            query?: "pd" | "glz"
        }
    ): Promise<T> {
        const baseUrl = args?.query == "pd" ?
            `https://pd.${API.shard}.a.pvp.net` :
            `https://glz-${API.region}-1.${API.shard}.a.pvp.net`;
        const response = await fetch(`${baseUrl}/${path}`, {
            headers: {
                "X-Riot-ClientPlatform": clientPlatform,
                "X-Riot-ClientVersion": API.clientVersion,
                "X-Riot-Entitlements-JWT": API.entitlementToken,
                "Authorization": `Bearer ${API.authToken}`
            },
            ...(requestInfo as any)
        });

        if (!response.ok) {
            console.error("Server did not return a good response.",
                response.status, await response.json());
            throw new Error("Failed to fetch data.");
        }

        return await response.json() as T;
    }

    /// </editor-fold>

    /// <editor-fold defaultstate="collapsed" desc="Local API">

    /**
     * Fetches the entitlements token for the player.
     */
    public static async getEntitlementsToken(): Promise<EntitlementsTokenResponse> {
        return await API.localRequest("entitlements/v1/token");
    }

    /**
     * Fetches the active chat session for the player.
     */
    public static async getChatSession(): Promise<ChatSessionResponse> {
        return await API.localRequest("chat/v1/session");
    }

    /**
     * Fetches all active Riot Games sessions.
     * This includes: VALORANT, League of Legends, and Riot Client.
     */
    public static async getSessions(): Promise<SessionsResponse> {
        return await API.localRequest("product-session/v1/sessions");
    }

    /**
     * Fetches the help information for the local API.
     */
    public static async getHelp(): Promise<LocalHelpResponse> {
        return await API.localRequest("help");
    }

    /// </editor-fold>

    /// <editor-fold defaultstate="collapsed" desc="Remote API">

    /**
     * Fetches the ID of the game the player is in.
     */
    public static async getCurrentGameId(): Promise<CurrentGamePlayerResponse> {
        return await API.remoteRequest(`core-game/v1/players/${API.playerUuid}`);
    }

    /**
     * Fetches the data of the game with the specified ID.
     *
     * @param gameId The game ID.
     */
    public static async getGameData(gameId: string): Promise<CurrentGameMatchResponse> {
        return await API.remoteRequest(`core-game/v1/matches/${gameId}`);
    }

    /**
     * Fetches the match history of the player.
     *
     * @param playerUuid The player UUID.
     * @param args Additional arguments.
     */
    public static async getMatchHistory(
        playerUuid: string,
        args?: {
            startIndex?: number;
            endIndex?: number;
            queue?: "competitive" | "unrated" | string;
        }
    ): Promise<MatchHistoryResponse> {
        let params = new URLSearchParams();
        params.append("startIndex", args?.startIndex?.toString() ?? "0");
        params.append("endIndex", args?.endIndex?.toString() ?? "20");
        params.append("queue", args?.queue ?? "competitive");

        return await API.remoteRequest(
            `match-history/v1/history/${playerUuid}?${params.toString()}`,
            undefined, { query: "pd" }
        );
    }

    /**
     * Fetches the match data of a match with the specified ID.
     * @param matchId
     */
    public static async getMatchData(matchId: string): Promise<MatchDetailsResponse> {
        return await API.remoteRequest(
            `match-details/v1/matches/${matchId}`,
            undefined, { query: "pd" }
        );
    }

    /// </editor-fold>

    /// <editor-fold defaultstate="collapsed" desc="WebSocket API">
    /// </editor-fold>
}

/// <editor-fold defaultstate="collapsed" desc="Client Types">
type APIInfo = {
    username: string;
    processId: number;
    port: number;
    password: string;
    protocol: string;
};

type EntitlementsTokenResponse = {
    /** Used as the token in requests */
    accessToken: string;
    entitlements: unknown[];
    issuer: string;
    /** Player UUID */
    subject: string;
    /** Used as the entitlement in requests */
    token: string;
};

type ChatSessionResponse = {
    federated: boolean;
    game_name: string;
    game_tag: string;
    loaded: boolean;
    name: string;
    pid: string;
    /** Player UUID */
    puuid: string;
    region: string;
    resource: string;
    state: string;
};

type SessionsResponse = {
    [x: string]: {
        exitCode: number;
        exitReason: null;
        isInternal: boolean;
        launchConfiguration: {
            arguments: string[];
            executable: string;
            locale: string | null;
            voiceLocale: null;
            workingDirectory: string;
        };
        patchlineFullName: "VALORANT" | "riot_client";
        patchlineId: "" | "live" | "pbe";
        phase: string;
        productId: "valorant" | "riot_client";
        version: string;
    };
};

type LocalHelpResponse = {
    events: {
        [x: string]: string;
    };
    functions: {
        [x: string]: string;
    };
    types: {
        [x: string]: string;
    };
};
/// </editor-fold>

/// <editor-fold defaultstate="collapsed" desc="Server Types">
type CurrentGamePlayerResponse = {
    /** Player UUID */
    Subject: string;
    /** Pre-Game Match ID */
    MatchID: string;
    Version: number;
};

type CurrentGameMatchResponse = {
    /** Current Game Match ID */
    MatchID: string;
    Version: number;
    State: "IN_PROGRESS";
    /** Map ID */
    MapID: string;
    /** Game Mode */
    ModeID: string;
    ProvisioningFlow: "Matchmaking" | "CustomGame";
    GamePodID: string;
    /** Chat room ID for "all" chat */
    AllMUCName: string;
    /** Chat room ID for "team" chat */
    TeamMUCName: string;
    TeamVoiceID: string;
    /** JWT containing match ID, participant IDs, and match region */
    TeamMatchToken: string;
    IsReconnectable: boolean;
    ConnectionDetails: {
        GameServerHosts: string[];
        GameServerHost: string;
        GameServerPort: number;
        GameServerObfuscatedIP: number;
        GameClientHash: number;
        PlayerKey: string;
    };
    PostGameDetails: null;
    Players: {
        /** Player UUID */
        Subject: string;
        TeamID: ("Blue" | "Red") | string;
        /** Character ID */
        CharacterID: string;
        PlayerIdentity: {
            /** Player UUID */
            Subject: string;
            /** Card ID */
            PlayerCardID: string;
            /** Title ID */
            PlayerTitleID: string;
            AccountLevel: number;
            /** Preferred Level Border ID */
            PreferredLevelBorderID: string | "";
            Incognito: boolean;
            HideAccountLevel: boolean;
        };
        SeasonalBadgeInfo: {
            /** Season ID */
            SeasonID: string | "";
            NumberOfWins: number;
            WinsByTier: null;
            Rank: number;
            LeaderboardRank: number;
        };
        IsCoach: boolean;
        IsAssociated: boolean;
    }[];
    MatchmakingData: null;
};

type MatchHistoryResponse = {
    /** Player UUID */
    Subject: string;
    BeginIndex: number;
    EndIndex: number;
    Total: number;
    History: {
        /** Match ID */
        MatchID: string;
        /** Milliseconds since epoch */
        GameStartTime: number;
        /** Queue ID */
        QueueID: string;
    }[];
};

type MatchDetailsResponse = {
    matchInfo: {
        /** Match ID */
        matchId: string;
        /** Map ID */
        mapId: string;
        gamePodId: string;
        gameLoopZone: string;
        gameServerAddress: string;
        gameVersion: string;
        gameLengthMillis: number | null;
        gameStartMillis: number;
        provisioningFlowID: "Matchmaking" | "CustomGame";
        isCompleted: boolean;
        customGameName: string;
        forcePostProcessing: boolean;
        /** Queue ID */
        queueID: string;
        /** Game Mode */
        gameMode: string;
        isRanked: boolean;
        isMatchSampled: boolean;
        /** Season ID */
        seasonId: string;
        completionState: "Surrendered" | "Completed" | "VoteDraw" | "";
        platformType: "PC";
        premierMatchInfo: {};
        partyRRPenalties?: {
            [x: string]: number;
        } | undefined;
        shouldMatchDisablePenalties: boolean;
    };
    players: {
        /** Player UUID */
        subject: string;
        gameName: string;
        tagLine: string;
        platformInfo: {
            platformType: "PC";
            platformOS: "Windows";
            platformOSVersion: string;
            platformChipset: "Unknown";
        };
        teamId: ("Blue" | "Red") | string;
        /** Party ID */
        partyId: string;
        /** Character ID */
        characterId: string;
        stats: {
            score: number;
            roundsPlayed: number;
            kills: number;
            deaths: number;
            assists: number;
            playtimeMillis: number;
            abilityCasts?: ({
                grenadeCasts: number;
                ability1Casts: number;
                ability2Casts: number;
                ultimateCasts: number;
            } | null) | undefined;
        } | null;
        roundDamage: {
            round: number;
            /** Player UUID */
            receiver: string;
            damage: number;
        }[] | null;
        competitiveTier: number;
        isObserver: boolean;
        /** Card ID */
        playerCard: string;
        /** Title ID */
        playerTitle: string;
        /** Preferred Level Border ID */
        preferredLevelBorder?: (string | "") | undefined;
        accountLevel: number;
        sessionPlaytimeMinutes?: (number | null) | undefined;
        xpModifications?: {
            /** XP multiplier */
            Value: number;
            /** XP Modification ID */
            ID: string;
        }[] | undefined;
        behaviorFactors?: {
            afkRounds: number;
            /** Float value of unknown significance. Possibly used to quantify how much the player was in the way of their teammates? */
            collisions?: number | undefined;
            commsRatingRecovery: number;
            damageParticipationOutgoing: number;
            friendlyFireIncoming?: number | undefined;
            friendlyFireOutgoing?: number | undefined;
            mouseMovement?: number | undefined;
            stayedInSpawnRounds?: number | undefined;
        } | undefined;
        newPlayerExperienceDetails?: {
            basicMovement: {
                idleTimeMillis: 0;
                objectiveCompleteTimeMillis: 0;
            };
            basicGunSkill: {
                idleTimeMillis: 0;
                objectiveCompleteTimeMillis: 0;
            };
            adaptiveBots: {
                adaptiveBotAverageDurationMillisAllAttempts: 0;
                adaptiveBotAverageDurationMillisFirstAttempt: 0;
                killDetailsFirstAttempt: null;
                idleTimeMillis: 0;
                objectiveCompleteTimeMillis: 0;
            };
            ability: {
                idleTimeMillis: 0;
                objectiveCompleteTimeMillis: 0;
            };
            bombPlant: {
                idleTimeMillis: 0;
                objectiveCompleteTimeMillis: 0;
            };
            defendBombSite: {
                success: false;
                idleTimeMillis: 0;
                objectiveCompleteTimeMillis: 0;
            };
            settingStatus: {
                isMouseSensitivityDefault: boolean;
                isCrosshairDefault: boolean;
            };
            versionString: "";
        } | undefined;
    }[];
    bots: unknown[];
    coaches: {
        /** Player UUID */
        subject: string;
        teamId: "Blue" | "Red";
    }[];
    teams: {
        teamId: ("Blue" | "Red") | string;
        won: boolean;
        roundsPlayed: number;
        roundsWon: number;
        numPoints: number;
    }[] | null;
    roundResults: {
        roundNum: number;
        roundResult: "Eliminated" | "Bomb detonated" | "Bomb defused" | "Surrendered" | "Round timer expired";
        roundCeremony: "CeremonyDefault" | "CeremonyTeamAce" | "CeremonyFlawless" | "CeremonyCloser" | "CeremonyClutch" | "CeremonyThrifty" | "CeremonyAce" | "";
        winningTeam: ("Blue" | "Red") | string;
        /** Player UUID */
        bombPlanter?: string | undefined;
        bombDefuser?: (("Blue" | "Red") | string) | undefined;
        /** Time in milliseconds since the start of the round when the bomb was planted. 0 if not planted */
        plantRoundTime?: number | undefined;
        plantPlayerLocations: {
            /** Player UUID */
            subject: string;
            viewRadians: number;
            location: {
                x: number;
                y: number;
            };
        }[] | null;
        plantLocation: {
            x: number;
            y: number;
        };
        plantSite: "A" | "B" | "C" | "";
        /** Time in milliseconds since the start of the round when the bomb was defused. 0 if not defused */
        defuseRoundTime?: number | undefined;
        defusePlayerLocations: {
            /** Player UUID */
            subject: string;
            viewRadians: number;
            location: {
                x: number;
                y: number;
            };
        }[] | null;
        defuseLocation: {
            x: number;
            y: number;
        };
        playerStats: {
            /** Player UUID */
            subject: string;
            kills: {
                /** Time in milliseconds since the start of the game */
                gameTime: number;
                /** Time in milliseconds since the start of the round */
                roundTime: number;
                /** Player UUID */
                killer: string;
                /** Player UUID */
                victim: string;
                victimLocation: {
                    x: number;
                    y: number;
                };
                assistants: string[];
                playerLocations: {
                    /** Player UUID */
                    subject: string;
                    viewRadians: number;
                    location: {
                        x: number;
                        y: number;
                    };
                }[];
                finishingDamage: {
                    damageType: "Weapon" | "Bomb" | "Ability" | "Fall" | "Melee" | "Invalid" | "";
                    /** Item ID of the weapon used to kill the player. Empty string if the player was killed by the spike, fall damage, or melee. */
                    damageItem: (string | ("Ultimate" | "Ability1" | "Ability2" | "GrenadeAbility" | "Primary")) | "";
                    isSecondaryFireMode: boolean;
                };
            }[];
            damage: {
                /** Player UUID */
                receiver: string;
                damage: number;
                legshots: number;
                bodyshots: number;
                headshots: number;
            }[];
            score: number;
            economy: {
                loadoutValue: number;
                /** Item ID */
                weapon: string | "";
                /** Armor ID */
                armor: string | "";
                remaining: number;
                spent: number;
            };
            ability: {
                grenadeEffects: null;
                ability1Effects: null;
                ability2Effects: null;
                ultimateEffects: null;
            };
            wasAfk: boolean;
            wasPenalized: boolean;
            stayedInSpawn: boolean;
        }[];
        /** Empty string if the timer expired */
        roundResultCode: "Elimination" | "Detonate" | "Defuse" | "Surrendered" | "";
        playerEconomies: {
            /** Player UUID */
            subject: string;
            loadoutValue: number;
            /** Item ID */
            weapon: string | "";
            /** Armor ID */
            armor: string | "";
            remaining: number;
            spent: number;
        }[] | null;
        playerScores: {
            /** Player UUID */
            subject: string;
            score: number;
        }[] | null;
    }[] | null;
    kills: {
        /** Time in milliseconds since the start of the game */
        gameTime: number;
        /** Time in milliseconds since the start of the round */
        roundTime: number;
        /** Player UUID */
        killer: string;
        /** Player UUID */
        victim: string;
        victimLocation: {
            x: number;
            y: number;
        };
        assistants: string[];
        playerLocations: {
            /** Player UUID */
            subject: string;
            viewRadians: number;
            location: {
                x: number;
                y: number;
            };
        }[];
        finishingDamage: {
            damageType: "Weapon" | "Bomb" | "Ability" | "Fall" | "Melee" | "Invalid" | "";
            /** Item ID of the weapon used to kill the player. Empty string if the player was killed by the spike, fall damage, or melee. */
            damageItem: (string | ("Ultimate" | "Ability1" | "Ability2" | "GrenadeAbility" | "Primary")) | "";
            isSecondaryFireMode: boolean;
        };
        round: number;
    }[] | null;
};
/// </editor-fold>
