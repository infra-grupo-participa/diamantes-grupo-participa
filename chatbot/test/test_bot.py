import unittest

from bot import create_session, process_message


class BotTest(unittest.TestCase):
    def test_responde_endereco_da_loja(self):
        result = process_message("onde fica a loja?", create_session())

        self.assertEqual(result["intent"], "location")
        self.assertIn("Av. Dom Helder Camara, 2504", result["reply"])
        self.assertFalse(result["needsHuman"])

    def test_coleta_dados_antes_de_encaminhar_preco(self):
        session = create_session()

        first = process_message("qual o preco do cimento cp ii 50kg?", session)
        self.assertEqual(first["intent"], "quote_collecting")
        self.assertFalse(first["needsHuman"])
        self.assertIn("quantidade", first["reply"].lower())

        second = process_message("10 sacos para entrega", session)
        self.assertEqual(second["intent"], "quote_handoff")
        self.assertTrue(second["needsHuman"])
        self.assertIn("cimento cp ii 50kg", second["summary"].lower())
        self.assertIn("10 sacos", second["summary"])
        self.assertIn("entrega", second["summary"])

    def test_feriado_pede_data_e_encaminha_para_confirmacao_humana(self):
        session = create_session()

        first = process_message("abre no feriado?", session)
        self.assertEqual(first["intent"], "holiday")
        self.assertFalse(first["needsHuman"])

        second = process_message("dia 1 de maio", session)
        self.assertEqual(second["intent"], "handoff")
        self.assertTrue(second["needsHuman"])
        self.assertIn("dia 1 de maio", second["summary"])

    def test_responde_formas_de_pagamento(self):
        result = process_message("aceita pix e cartao?", create_session())

        self.assertEqual(result["intent"], "payment")
        self.assertIn("Pix com 5% de desconto", result["reply"])
        self.assertFalse(result["needsHuman"])


if __name__ == "__main__":
    unittest.main()
