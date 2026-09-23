select sum(quantidade) as quantidade, descricao, SUM(CAST(total AS decimal(18,2))) AS total  from wsir_vnd_vendas WHERE tipolinha = 'P' and Anulado = 0
GROUP BY descricao, total