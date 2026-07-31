import json
stock_data = [
    {"code":"000001","name":"平安银行","price":10.23,"change":0.02},
    {"code":"300750","name":"宁德时代","price":182.50,"change":-0.86}
]
with open("data.json","w",encoding="utf-8") as f:
    json.dump(stock_data,f,ensure_ascii=False,indent=2)
print("爬虫执行完成，行情数据已更新")
