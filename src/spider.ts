import * as cheerio from "cheerio";
import { createConnection, Schema } from "mongoose";
import * as request from "request-promise";

const tiebaPrefix = "http://tieba.baidu.com";

const parseBr = (content) => content.replace(/<br\s*\/?>/g, "|");
const load = (content) => content ? cheerio.load(parseBr(content)) : null;
const pureText = (content) => content ? cheerio.load(content).root().text() : "";

interface ISpiderOption {
    db_name?: string;
    db_host?: string;
    max_connection_num?: number;
    max_fail_num?: number;
    page_num?: number;
    timeout_duration?: number;
    specific_table?: string;
    specific_keywords?: string[];
    update_list: string[];
};

const sleep = (time) => {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve();
        }, time);
    });
};

export async function spider(options: ISpiderOption) {
    const context = {
        current_connection_num: 0,
        db_host: options.db_host || "localhost",
        db_name: options.db_name || "tieba",
        error_num: 0,
        max_connection_num: options.max_connection_num || 100,
        max_fail_num: options.max_fail_num || 5,
        page_num: options.page_num || 20,
        parsedUrl: new Set(),
        specific_keywords: options.specific_keywords || null,
        specific_table: options.specific_table || null,
        timeout_duration: options.timeout_duration || 1500,
    };

    const db = createConnection(context.db_host, context.db_name);

    const topicSchema = new Schema({
        author_name: String,
        create_time: Date,
        page_num: Number,
        reply_num: Number,
        tieba: String,
        title: String,
        url: String,
    });
    topicSchema.index({ tieba: 1 });
    topicSchema.index({ url: 1 });
    topicSchema.index({ create_time: 1 });
    const topics = db.model("topics", topicSchema);

    const postSchema = new Schema({
        author_name: String,
        content: String,
        create_time: Date,
        tieba: String,
        url: String,
    });
    postSchema.index({ tieba: 1 });
    postSchema.index({ url: 1 });
    postSchema.index({ create_time: 1 });
    const posts = db.model("posts", postSchema);

    const update_list = options.update_list;

    const specific_table = context.specific_table ? db.model(context.specific_table, postSchema) : null;

    const httpGet = async(url, isJson = false, fail_num = 0) => {
        if (context.parsedUrl.has(url) || fail_num >= 3) {
            return null;
        }
        context.parsedUrl.add(url);
        while (context.current_connection_num > context.max_connection_num) {
            await sleep(context.timeout_duration);
        }
        ++context.current_connection_num;
        console.info(`downloading ${url}, there are now ${context.current_connection_num} connections`);
        try {
            const data = await request(url, {json: isJson});
            --context.current_connection_num;
            return data;
        } catch (e) {
            console.warn("error", ++context.error_num);
            --context.current_connection_num;
            return await httpGet(url, isJson, fail_num + 1);
        }
    };

    const httpGetJson = async(url) => {
        return await httpGet(url, true);
    };

    const httpGetHtml = async(url) => {
        const body = await httpGet(url);
        return load(body);
    };

    const hasSpecificKeyword = (content) => {
        for (const keyword in context.specific_keywords) {
            if (content.indexOf(keyword) !== -1) {
                return true;
            }
        }
        return false;
    };

    const parseReply = async(url, tieba) => {
        const data = await httpGetJson(url);
        if (!data || !data.data || data.data.comment_list.length === 0) {
            return;
        }
        const body = data.data;

        let i = 0;
        for (const cid of Object.keys(body.comment_list)) {
            const comment = body.comment_list[cid];
            if (comment.comment_info.length > 0) {
                let j = 0;
                for (const reply of comment.comment_info) {
                    try {
                        const count = await posts.where("url").equals(`${url}#${i}#${j}`).count();
                        if (count !== 0) {
                            continue;
                        }
                        const content = pureText(reply.content);
                        const author_name = reply.username;
                        const create_time = new Date(reply.now_time * 1000);
                        const current = {
                            url: `${url}#${i}#${j}`,
                            content,
                            author_name,
                            tieba,
                            create_time,
                        };
                        const entity = (new posts(current));
                        await entity.save();
                        if (specific_table && hasSpecificKeyword(content)) {
                            const spec_entity = (new specific_table(current));
                            await spec_entity.save();
                        }
                    } catch (e) {
                        console.warn(e);
                    }
                    ++j;
                }
            }
            ++i;
        }
        // console.info(`${url}'s reply was added`, context.current_connection_num);
    };

    const parsePage = async(url, pn, tieba) => {
        const $ = await httpGetHtml(url);
        if ($ === null) {
            return;
        }
        const container = $("#container");
        const j_l_post = container.find(".j_l_post");
        const topicData = JSON.parse(j_l_post.first().attr("data-field"));
        const fid = topicData.content.forum_id;
        const tid = topicData.content.thread_id;
        await parseReply(`http://tieba.baidu.com/p/totalComment?tid=${tid}&fid=${fid}&pn=${pn}`, tieba);
        const elements = j_l_post.map((index, element) => element);
        for (let i = 0; i < elements.length; ++i) {
            const d = elements[i];
            try {
                const count = await topics.where("url").equals(`${url}#${i}`).count();
                if (count !== 0) {
                    continue;
                }
                const content = $(d).find(".j_d_post_content").text();
                const author_name = $(d).find(".p_author_name").text();
                const create_time = new Date($(d).find(".post-tail-wrap").find(".tail-info").last().text());
                const current = {
                    url: `${url}#${i}`,
                    content,
                    tieba,
                    author_name,
                    create_time,
                };
                const entity = (new posts(current));
                await entity.save();
                if (specific_table && hasSpecificKeyword(content)) {
                    const spec_entity = (new specific_table(current));
                    await spec_entity.save();
                }
            } catch (e) {
                continue;
            }
            ++i;
        }
    };

    const parseFirstPage = async(url, current) => {
        const $ = await httpGetHtml(url);
        if ($ === null) {
            return;
        }
        // console.info(`now solveing ${url}`);
        const page_num: number = parseInt($(".l_reply_num").find(".red").last().text(), 10);
        // console.info(url, "has", page_num, "pages", context.current_connection_num);
        const tasks = new Array<Promise<void>>();
        for (let page = current.page_num; page <= page_num; ++page) {
            tasks.push(parsePage(`${current.url}?pn=${page}`, page, current.tieba));
            // await parsePage(`${current.url}?pn=${page}`, page, current.tieba);
        }
        try {
            const count = await topics.where("url").equals(url).count();
            if (count === 0) {
                current.create_time = new Date($(".post-tail-wrap").find(".tail-info").last().text());
                current.page_num = page_num;
                const entity = (new topics(current));
                await entity.save();
            }
        } catch (e) {
            console.warn(e);
        }
        for (const task of tasks) {
            await task;
        }
    };

    const parsePages = async(url, tieba) => {
        const $ = await httpGetHtml(url);
        if ($ === null) {
            return;
        }
        const thread_list = $(".j_thread_list").map((i, d) => d);
        // console.log(thread_list);
        const tasks = new Array<Promise<void>>();
        for (let i = 0; i < thread_list.length; ++i) {
            const d = thread_list[i];
            const data_field = JSON.parse($(d).attr("data-field"));
            const j_th_tit = $(d).find("a.j_th_tit");
            const url0 = tiebaPrefix + j_th_tit.attr("href");
            const title = j_th_tit.attr("title");
            const create_time = 0; // $(d).find('.is_show_create_time').text()
            const reply_num = data_field.reply_num;
            const author_name = data_field.author_name;
            try {
                const olddata = await topics.where("url").equals(url0).exec();
                if (olddata.length > 0 && olddata[0].reply_num === reply_num) {
                    continue;
                }
                const page_num = olddata.length ? olddata[0].page_num : 1;
                const current = {
                    url: url0,
                    title,
                    tieba,
                    author_name,
                    reply_num,
                    page_num,
                    create_time,
                };
                // await parseFirstPage(url0, current);
                tasks.push(parseFirstPage(url0, current));
                console.info(`Move ${url0} to task`);
            } catch (e) {
                console.warn(e);
            }
        }
        for (const task of tasks) {
            await task;
        }
    };

    const tasks = new Array<Promise<void>>();
    for (const tieba of update_list) {
        for (let pn = 0, num = 0; num < context.page_num; num += 1, pn += 50) {
            tasks.push(parsePages(encodeURI(`${tiebaPrefix}/f?kw=${tieba}&pn=${pn}`), tieba));
            // await parsePages(encodeURI(`${tiebaPrefix}/f?kw=${tieba}&pn=${pn}`), tieba);
        }
    }
    for (const task of tasks) {
        await task;
    }
    console.info("spider finish");
};
