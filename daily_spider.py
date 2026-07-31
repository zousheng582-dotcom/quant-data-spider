import json
import akshare as ak
# 爬取A股大盘数据
stock_index_zh_hist_df = ak.stock_index_zh_hist(symbol="000001")
# 转json存入文件
stock_data = stock_index_zh_hist_df.to_dict("records")
with open("data.json","w",encoding="utf-8") as f:
    json.dump(stock_data,f,ensure_ascii=False,indent=2)
print("A股指数数据更新完成")
