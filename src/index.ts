import API from "@app/api.ts";

if (!await API.setupClient()) {
    process.exit(1);
}
