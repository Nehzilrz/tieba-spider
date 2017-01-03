const http = require('http')
const promisify = require('es6-promisify')
const load = require('cheerio').load
const RxHttpRequest = require('rx-http-request').RxHttpRequest
const tieba = 'http://tieba.baidu.com'

const mongoose = require('mongoose')
const db = mongoose.createConnection('localhost', 'tieba')
const topicSchema = new mongoose.Schema({
    url: String,
    title: String,
    author_name: String,
    // user_id: String,
    reply_num: Number,
    create_time: Date,
})
topicSchema.index({url: 1})
topicSchema.index({create_time: 1})
const topics = db.model('topics', topicSchema)

const get = (url, cb) => RxHttpRequest.get(url).subscribe(
    (data) => {
        if (data.response.statusCode === 200) {
            cb(load(data.body))
        }
    },
    (err) => {
        console.error(err)
    }
)

const parseReply = (url, urlSet) => !urlSet.has(url) ? (urlSet.add(url), RxHttpRequest.get(url, {json: true}).subscribe(
    (data) => {
        if (data.response.statusCode === 200) {
            const result = data.body.data;
            for (const comment of Object.values(result.comment_list)) {
                console.log(comment.comment_info)
            }
        }
    },
    (err) => {

    }
)) : null

const parseTopic = (url, pn, urlSet) => !urlSet.has(url) ? (urlSet.add(url), get(url, ($) => {
    console.log(url)
    const container = $('#container')
    const j_l_post = container.find('.j_l_post')
    const topicData = JSON.parse(j_l_post.first().attr('data-field'))
    const fid = topicData.content.forum_id
    const tid = topicData.content.thread_id
    parseReply(`http://tieba.baidu.com/p/totalComment?tid=${tid}&fid=${fid}&pn=${pn}`, urlSet)
    j_l_post.each((i, d) => {
        try {
            const content = $(d).find('.j_d_post_content').text()
            const create_time = new Date($(d).find('.post-tail-wrap').find('.tail-info').last().text())
        } catch (e) {

        }
        // http://tieba.baidu.com/p/totalComment?t=1483423054869&tid=4923264050&fid=2231821&pn=52&see_lz=0
    })
})) : null

const parseTopics = (url, current, urlSet) => !urlSet.has(url) ? (urlSet.add(url), get(url, ($) => {
    const pageNum = parseInt($('.l_reply_num').find('.red').last().text())
    topics.where('url').equals(current.url).count((err, count) => {
        if (err) {

        } else if (count === 0) {
            current.create_time = new Date($('.post-tail-wrap').find('.tail-info').last().text())
            const entity = (new topics(current))
            entity.save()
        }
    })
    console.log(url, 'has', pageNum, 'pages')
    for (let page = 1; page <= pageNum; ++page) {
        parseTopic(`${current.url}?pn=${page}`, page, urlSet)
    }
})) : null

const parseRoot = (url, urlSet) => !urlSet.has(url) ? (urlSet.add(url), get(url, ($) => {
    $('.j_thread_list').each((i, d) => {
        const data_field = JSON.parse($(d).attr('data-field'))
        const j_th_tit = $(d).find('a.j_th_tit')
        const url = tieba + j_th_tit.attr('href')
        const title = j_th_tit.attr('title')
        const create_time = 0 // $(d).find('.is_show_create_time').text()
        const reply_num = data_field.reply_num
        const author_name = data_field.author_name
        // const author_id = JSON.parse($(d).find('.tb_icon_author').attr("data-field")).user_id
        const current = {
            url,
            title,
            author_name,
            reply_num,
            create_time,
        }
        parseTopics(url, current, urlSet)
    })
})) : null

const spider = (url, pageNum) => {
    pageNum = pageNum || 1000
    const urlSet = new Set()
    for (let pn = 0; pn < pageNum; pn += 50) {
        parseRoot(`${url}&pn=${pn}`, urlSet)
    }
}

// parseTopic('http://tieba.baidu.com/p/4923264050', 1, new Set())
spider(`${tieba}/f?kw=%E5%8F%8C%E6%A2%A6%E9%95%87`)
