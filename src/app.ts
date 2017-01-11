import * as fs from "fs";
import { spider } from "./spider";

const configPath = "./config.json";
const config = fs.readFileSync(configPath, "utf-8");
const options = JSON.parse(config);
spider(options);
