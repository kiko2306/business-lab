
DROP PROCEDURE IF EXISTS _tmp_update_responses;
DELIMITER $$
CREATE PROCEDURE _tmp_update_responses()
BEGIN
    DECLARE cursor_List_groups BOOLEAN DEFAULT FALSE;

    -- Vars
    DECLARE _id INT;
    DECLARE _quiz_id INT;
    DECLARE _cko_question_id INT;
    DECLARE _answer TEXT;
    DECLARE _created_at DATETIME;
    DECLARE _updated_at DATETIME;

     DECLARE cursor_List CURSOR FOR
         SELECT
                `id`,
                `quiz_id`,
                `cko_question_id`,
                `answer`,
                `created_at`,
                `updated_at`
               FROM `guestqui_hotelutils`.`quiz_responses`;


DECLARE CONTINUE HANDLER FOR NOT FOUND SET cursor_List_groups = TRUE;

OPEN cursor_List;

   loop_List: LOOP
      FETCH cursor_List INTO
            _id,
            _quiz_id,
            _cko_question_id,
            _answer,
            _created_at,
            _updated_at;

        IF cursor_List_groups THEN
            LEAVE loop_List;
        END IF;

     INSERT INTO `testing`.`hu_quiz_responses`
                                        (
                                            `id`,
                                            `reservation_id`,
                                            `quiz_question_id`,
                                            `answer`,
                                            `created_at`,
                                            `updated_at`
                                            )
                                VALUES (
                                            _id,
                                            _quiz_id,
                                            _cko_question_id,
                                            REPLACE(_answer, '\\', ''),
                                            _created_at,
                                            _updated_at);

END LOOP loop_List;

   CLOSE cursor_List;
END

$$

DELIMITER ;

CALL _tmp_update_responses();
