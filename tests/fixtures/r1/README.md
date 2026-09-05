# R1 人工样例

fixture.csv / fixture.xlsx / fixture.sav 均由 tests/r1-data-contract-smoke.mjs 的同一组人工行生成。重建命令：node tests/r1-data-contract-smoke.mjs --write-fixtures。

13 个有效数值 0–12；NPS 一个 0、十二个 10；9 个 A、4 个 B。另有 A 的空白及纯空格行和一个缺失分组行。NPS=84.6，均值=6，base=13，B 的 yes=100%。CSV/XLSX 的空单元格与 SAV system missing 代表同一缺失口径。SAV 不带值标签，此轮不覆盖值标签清洗保真（第二轮）。截尾断言另取前十行，设定 9:1 分组。
