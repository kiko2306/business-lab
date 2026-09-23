-- O quiz id = 1 e o importado

DROP PROCEDURE IF EXISTS _tmp_update_questions;
DELIMITER $$
CREATE PROCEDURE _tmp_update_questions()
BEGIN
    DECLARE cursor_List_groups BOOLEAN DEFAULT FALSE;

    -- Vars
    DECLARE _id INT;
    DECLARE _question VARCHAR(255);
    DECLARE _type VARCHAR(255);
    DECLARE _order INT;
    DECLARE _quiz_header_id INT;
    DECLARE _created_at DATETIME;
    DECLARE _updated_at DATETIME;

     DECLARE cursor_List CURSOR FOR
         SELECT
                `id`,
                `question`,
                `type`,
                `order`,
                `quiz_header_id`,
                `created_at`,
                `updated_at`
               FROM `guestqui_hotelutils`.`cko_questions`;


DECLARE CONTINUE HANDLER FOR NOT FOUND SET cursor_List_groups = TRUE;

OPEN cursor_List;

   loop_List: LOOP
      FETCH cursor_List INTO
            _id,
            _question,
            _type,
            _order,
            _quiz_header_id,
            _created_at,
            _updated_at;

        IF cursor_List_groups THEN
            LEAVE loop_List;
        END IF;

     INSERT INTO `testing`.`hu_quiz_questions`
                                        (   `id`,
                                            `quiz_header_id`,
                                            `question`,
                                            `type`,
                                            `order`,
                                            `is_active`,
                                            `created_at`,
                                            `updated_at`)
                                VALUES (
                                            _id,
                                            _quiz_header_id,
                                            _question,
                                            UPPER(_type),
                                            _order,
                                            0,
                                            _created_at,
                                            _updated_at);

END LOOP loop_List;

   CLOSE cursor_List;
END

$$

DELIMITER ;

CALL _tmp_update_questions();

UPDATE `testing`.`hu_quiz_questions` SET type='VALUE' WHERE type='NUMBER';
