# tieba-spider
#### A extremely fast tool to crawl the posts and replies in Baidu Tieba. The tool will store data in mongodb automatically.

Set config.json as the follow schema.
```typescript
{
    db_name?: string; // default = "tieba"
    db_host?: string; // default = "localhost"
    max_connection_num?: number; // default = 100
    max_fail_num?: number; // default = 5
    page_num?: number; // default = 20
    timeout_duration?: number; // default = 1500 ms
    specific_table?: string;
    specific_keywords?: string[];
    update_list: string[];
};
```

And here it is a config.json example.
```javascript
{
    "max_connection_num": 100,
    "page_num": 2,
    "specific_keywords": ["卖", "买", "出", "收"],
    "specific_table": "transactions",
    "update_list": ["双梦镇", "乾坤一掷", "风雨大姨妈", "唯满侠", "圣墓山"]
}
```
