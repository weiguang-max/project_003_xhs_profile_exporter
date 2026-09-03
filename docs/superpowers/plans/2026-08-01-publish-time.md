# 发布时间采集实施计划

1. 在 `note-utils.js` 增加详情层发布时间提取，并先用测试锁定 `07-02` 原样保存。
2. 在 `content.js` 候选行和详情回写中传递 `publishTime`，不把发布时间设为必需采集条件。
3. 在 `sidepanel.js` 增加面板显示和 Excel 列，在 `feishu-utils.js`、`background.js` 增加飞书字段及字段校验。
4. 更新 README，重新生成 `extension.zip`。
5. 运行单元测试、JavaScript 语法检查、差异检查和 ZIP 完整性检查。
