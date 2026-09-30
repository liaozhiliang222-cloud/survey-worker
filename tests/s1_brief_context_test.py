import unittest
from pptx_report.wizard import build_insight_context

class BriefContextUnits(unittest.TestCase):
    def test_units_and_percent_boundaries(self):
        for kind, source, expected in [('mean', 0.5, 0.5), ('nps', -0.5, -0.5), ('count', 1, 1), ('percentage', 0, 0), ('percentage', 0.995, 99.5), ('percentage', 1, 100)]:
            with self.subTest(kind=kind, source=source):
                question = dict(code='Q1', title='测试', data_kind=kind, segments=['Total'], categories=['选项A','选项B'], data={'Total':[source, source]}, base={'Total':100})
                result = build_insight_context([question], {'pages':[{'page_idx':1,'questions':[{'code':'Q1'}]}]})
                evidence = result['pages'][0]['questions'][0]
                self.assertEqual(evidence['rows'][0]['values']['总体'], expected)
                self.assertEqual(evidence['data_kind'], kind)

if __name__ == '__main__':
    unittest.main()
