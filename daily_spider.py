import json
import akshare as ak

# 获取上证指数日线
df = ak.stock_zh_index_daily(symbol="sh000001")

# 把所有日期列转为字符串，解决json无法序列化date的问题
df["date"] = df["date"].astype(str)

# 转列表字典
stock_data = df.to_dict("records")

# 写入json文件
with open("data.json", "w", encoding="utf-8") as f:
    json.dump(stock_data, f, ensure_ascii=False, indent=2)

print("A股指数数据更新完成")
