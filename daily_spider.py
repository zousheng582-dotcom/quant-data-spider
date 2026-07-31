import json
import akshare as ak

# 获取上证指数日线数据（新版有效接口）
df = ak.stock_zh_index_daily(symbol="sh000001")
# 转为json写入文件
stock_data = df.to_dict("records")
with open("data.json","w",encoding="utf-8") as f:
    json.dump(stock_data,f,ensure_ascii=False,indent=2)
print("A股指数数据更新完成")
