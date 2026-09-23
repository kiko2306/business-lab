SELECT 
	datadoc, 
	SUM(CAST ((merc1+merc2+merc3+merc4+iva1+iva2+iva3+iva4) AS DECIMAL(18,2))) as total
	
FROM 
	wgcdoccab 

WHERE 
	anulado = 0 AND 
	datadoc >= DATEADD(DAY,-7,CONVERT (date, GETDATE()))

GROUP BY 
	datadoc